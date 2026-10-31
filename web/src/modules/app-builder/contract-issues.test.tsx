/* @vitest-environment jsdom */
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '@/messages/en.json';
import arMessages from '@/messages/ar.json';
import { ContractIssuesNotice, KNOWN_ISSUE_CODES, issueText, parseContractIssues } from './contract-issues';

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), '../contracts/app-builder/contract-issues.v1.json'), 'utf8')) as {
  codes: { error: string[]; warning: string[] };
};

const t = (key: string) => key;
const issue = (code: string, blocks = true) => ({ code, severity: blocks ? 'error' as const : 'warning' as const, page_id: 'home', node_id: 'n', field: null, message: 'server text', blocks_publish: blocks });

describe('contract issue codes', () => {
  afterEach(cleanup);

  it('the web knows exactly the codes in the shared contract fixture', () => {
    expect([...KNOWN_ISSUE_CODES].sort()).toEqual([...fixture.codes.error, ...fixture.codes.warning].sort());
  });

  it.each([['ar', arMessages], ['en', enMessages]] as const)('every code has a %s translation', (_lang, messages) => {
    const codes = (messages as unknown as { appBuilder: { builder: { issues: { codes: Record<string, string> } } } }).appBuilder.builder.issues.codes;
    for (const code of KNOWN_ISSUE_CODES) expect(codes[code], code).toBeTruthy();
  });

  it('an unknown code falls back to the server message', () => {
    expect(issueText(issue('brand_new_rule'), t)).toBe('server text');
    expect(issueText(issue('unknown_prop', false), t)).toBe('issues.codes.unknown_prop');
  });

  it('parseContractIssues accepts only contract_violations bodies', () => {
    expect(parseContractIssues({ reason: 'contract_violations', issues: [issue('page_not_root')] })).toHaveLength(1);
    expect(parseContractIssues({ reason: 'other', issues: [issue('x')] })).toBeNull();
    expect(parseContractIssues(null)).toBeNull();
    expect(parseContractIssues({ reason: 'contract_violations', issues: 'nope' })).toBeNull();
  });

  it('the notice is absent without issues and never blocks anything (informational)', () => {
    const { container } = render(<ContractIssuesNotice issues={[]} t={t} />);
    expect(container.firstChild).toBeNull();
    render(<ContractIssuesNotice issues={[issue('page_not_root')]} t={t} />);
    expect(screen.getByTestId('contract-issues')).toBeTruthy();
  });
});
