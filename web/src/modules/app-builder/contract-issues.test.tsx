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

describe('visibility signal labels', () => {
  it('every dotted signal id has a dot-free message key in both languages (next-intl reads dots as nesting)', async () => {
    const { signalKey } = await import('./inspector');
    expect(signalKey('cart.itemCount')).toBe('cart_itemCount');
    for (const messages of [arMessages, enMessages]) {
      const options = (messages as unknown as { appBuilder: { builder: { visibility: { signalOption: Record<string, string> } } } }).appBuilder.builder.visibility.signalOption;
      for (const key of Object.keys(options)) expect(key.includes('.'), key).toBe(false);
      for (const signal of ['cart.itemCount', 'customer.isAuthenticated', 'product.inStock']) expect(options[signalKey(signal)], signal).toBeTruthy();
    }
  });
});

describe('issue markers', () => {
  it('buildIssueMarkers keeps only the shown page, ignores node-less issues, and lets errors win over warnings', async () => {
    const { buildIssueMarkers, sectionMarker } = await import('./issue-markers');
    const mk = (code: string, page: string, node: string | null, blocks: boolean) => ({ code, severity: blocks ? 'error' as const : 'warning' as const, page_id: page, node_id: node, field: null, message: 'x', blocks_publish: blocks });
    const markers = buildIssueMarkers([mk('a', 'home', 'n1', false), mk('b', 'home', 'n1', true), mk('c', 'home', 'n2', false), mk('d', 'cart', 'n3', true), mk('e', 'home', null, true)], 'home');

    expect([...markers.entries()].sort()).toEqual([['n1', 'error'], ['n2', 'warning']]);
    expect(buildIssueMarkers([mk('a', 'home', 'n1', true)], null).size).toBe(0);

    const section = { type: 'Section', id: 's', children: [{ type: 'Text', id: 'n2' }, { type: 'Text', id: 'n1' }] };
    expect(sectionMarker(section, markers)).toBe('error');
    expect(sectionMarker({ type: 'Section', id: 's2', children: [{ type: 'Text', id: 'n2' }] }, markers)).toBe('warning');
    expect(sectionMarker({ type: 'Section', id: 's3', children: [] }, markers)).toBeNull();
  });
});
