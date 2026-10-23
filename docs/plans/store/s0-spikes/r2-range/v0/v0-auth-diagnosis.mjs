// Pure classifier for the R2 auth diagnosis (v0-auth-diagnose.php). Input: {format, calls} — booleans and {name, ok, status, awsCode} only; nothing secret exists here.
//
// The key discriminator is the "bad secret" control: it signs with the REAL access key id and a wrong secret.
//   SignatureDoesNotMatch → R2 recognised the key id (the signing path — endpoint, region, addressing — is sound; a wrong secret is reported as a signing error).
//   same code as a random unknown key → R2 does not recognise the key id on this endpoint's account (wrong account id in the endpoint, deleted/expired token, wrong value).
// With a recognised key id, AccessDenied on the real calls is an AUTHORISATION result (R2: "the token or credentials lack permission for the requested bucket or operation"),
// not a signing result.

const find = (calls, name) => calls.find((c) => c.name === name);
const code = (c) => c?.awsCode ?? (c?.ok ? 'OK' : null);

export function classify({ format = {}, calls = [] }) {
  const f = format;
  const bad = find(calls, 'control-bad-secret'); const unk = find(calls, 'control-unknown-key');
  const headV = find(calls, 'head-bucket/virtual'); const headP = find(calls, 'head-bucket/path');
  const listV = find(calls, 'list-prefix/virtual'); const listP = find(calls, 'list-prefix/path');
  const put = find(calls, 'put'); const del = find(calls, 'delete'); const headAfter = find(calls, 'head-after-delete');
  const facts = [];
  const done = (verdict, summary, step, extra = {}) => ({ verdict, summary, correctiveStep: step, facts, credentialsUsable: verdict === 'credentials_ok', ...extra });

  if (!f.s3_endpoint_present || !f.s3_key_present || !f.s3_secret_present || !f.s3_bucket_present) return done('config_missing', 'A required environment secret is empty.', 'Set S3_ENDPOINT, S3_KEY, S3_SECRET and S3_BUCKET in the r2-vg1-probe environment.');
  if (f.key_has_whitespace || f.secret_has_whitespace || f.bucket_has_whitespace) return done('whitespace_in_secret', 'A secret value contains whitespace (often a pasted trailing newline).', 'Re-enter the secret without surrounding whitespace.');
  if (!f.endpoint_shape_ok) facts.push('S3_ENDPOINT does not look like https://<32-hex account id>[.eu|.fedramp|.us].r2.cloudflarestorage.com');
  if (!f.key_is_32_hex || !f.secret_is_64_hex) facts.push(`credential shape unusual (S3_KEY 32 hex: ${f.key_is_32_hex}; S3_SECRET 64 hex: ${f.secret_is_64_hex}) — R2 S3 credentials are an Access Key ID (32 hex) and a Secret Access Key (64 hex); the API "token value" is neither`);
  if (!f.key_secret_differ) facts.push('S3_KEY and S3_SECRET are identical');
  if (!f.bucket_name_shape_ok) facts.push('S3_BUCKET is not a valid bucket name shape');

  const keyKnown = bad ? (bad.awsCode === 'SignatureDoesNotMatch' ? true : (unk && bad.awsCode === unk.awsCode ? false : null)) : null;
  facts.push(`control-bad-secret → ${code(bad)}; control-unknown-key → ${code(unk)}; recognised key id: ${keyKnown}`);
  for (const c of [headV, listV, headP, listP, put, del, headAfter]) if (c) facts.push(`${c.name} → ${c.status ?? 'n/a'} ${code(c)}`);

  const real = [headV, listV].filter(Boolean);
  const realCodes = real.map(code);
  if (real.some((c) => c.awsCode === 'SignatureDoesNotMatch')) {
    return done('secret_mismatch', 'R2 recognised the key id but the secret does not match it (signature mismatch with the real credentials).', 'Re-copy the Secret Access Key (shown once at token creation) for this exact Access Key ID; if it is lost, roll the token and store the new pair.');
  }
  if (keyKnown === false) {
    return done('key_id_not_recognised', 'R2 does not recognise this Access Key ID on this endpoint\'s account (a wrong key id behaves like a random one).', 'Check, without printing: S3_KEY is the token\'s Access Key ID (not the token value); the account id in S3_ENDPOINT is the account that owns the token; the token is not deleted, disabled or expired. Re-create the token if unsure.');
  }
  if (realCodes.includes('NoSuchBucket')) {
    return done('bucket_not_found', 'The bucket name is not found at this endpoint.', 'Verify S3_BUCKET spelling and that the bucket is in the same account; a bucket created with an EU / FedRAMP jurisdiction is reachable only through the matching ".eu." / ".fedramp." endpoint.');
  }
  const readOk = real.length === 2 && real.every((c) => c.ok);
  if (readOk && put && !put.ok && put.awsCode === 'AccessDenied') {
    return done('token_cannot_write', 'The token can read this bucket but is denied PutObject.', 'Recreate the token with permission "Object Read & Write" (not "Object Read only") scoped to this bucket.');
  }
  if (readOk && put?.ok && del?.ok) {
    const gone = headAfter && !headAfter.ok && headAfter.status === 404;
    const styleDiff = headP && listP && (headP.ok !== headV.ok || listP.ok !== listV.ok);
    return done(styleDiff ? 'addressing_style_specific' : 'credentials_ok', styleDiff ? 'Credentials work in one addressing style but not the other.' : 'Read, write and delete on this bucket all succeeded; the earlier AccessDenied is not explained by credentials or signing.', gone ? (styleDiff ? 'Use the working style for the probe (S3_PATH_STYLE).' : 'Re-run the probe; if it still fails, compare the failing step with this result.') : 'The diagnostic object may remain; delete the prefix v0-range-probe/diag-* by hand.');
  }
  if (keyKnown === true && real.length && real.every((c) => !c.ok && c.awsCode === 'AccessDenied')) {
    return done('no_permission_on_bucket', 'The key id is recognised and the signing path is sound (the bad-secret control reports a signature error), but every real call is AccessDenied — an authorisation result: the token has no permission on this bucket.', 'In Cloudflare R2 → Manage API tokens: confirm the token applies to THIS bucket (not another one, not "Specific bucket" of a different name), has "Object Read & Write", is not expired or disabled, and that S3_BUCKET is exactly that bucket. If unsure, create a token for this bucket and replace S3_KEY / S3_SECRET.');
  }
  return done('inconclusive', 'The calls do not match a known pattern.', 'Read the facts below.');
}

export function toMarkdown(result, format = {}) {
  const lines = [`### R2 auth diagnosis — \`${result.verdict}\``, '', result.summary, '', `**Corrective step:** ${result.correctiveStep}`, '', '| Fact |', '|---|', ...result.facts.map((x) => `| ${String(x).replace(/\|/g, '/')} |`)];
  const fmt = Object.entries(format).map(([k, v]) => `${k}=${v}`).join(', ');
  if (fmt) lines.push('', `Format checks (booleans only): ${fmt}`);
  return lines.join('\n');
}
