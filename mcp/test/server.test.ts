import { describe, expect, it } from 'vitest';
import { createKalamServer } from '../src/server';
import { connect, data, fixture, text } from './helpers';

const CORE_TOOLS = [
  'kalam_spec_schema', 'kalam_validate_spec', 'kalam_list_templates', 'kalam_build_from_template', 'kalam_classify_request',
  'kalam_explain_spec', 'kalam_diff_specs', 'kalam_check_formula', 'kalam_explain_formula', 'kalam_compute_report',
  'kalam_package_app',
];

describe('MCP round trip (in-memory transport)', () => {
  it('lists only the core tools by default: no file and no cloud tools', async () => {
    const client = await connect(createKalamServer());
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.sort()).toEqual([...CORE_TOOLS].sort());
    expect(client.getInstructions()).toMatch(/kalam_classify_request/);
    await client.close();
  });

  it('runs a whole flow: classify, build from template, validate, explain, package', async () => {
    const client = await connect(createKalamServer());
    const cls = data(await client.callTool({ name: 'kalam_classify_request', arguments: { request: 'a counter for glasses of water' } }));
    const built = await client.callTool({
      name: 'kalam_build_from_template',
      arguments: { templateId: cls.classification.matchingTemplate, request: 'a counter for glasses of water' },
    });
    const spec = data(built).spec;
    expect(data(await client.callTool({ name: 'kalam_validate_spec', arguments: { spec } })).ok).toBe(true);
    const explained = await client.callTool({ name: 'kalam_explain_spec', arguments: { spec } });
    expect(text(explained as never)).toMatch(/Screens:/);
    const pkg = data(await client.callTool({ name: 'kalam_package_app', arguments: { spec: JSON.stringify(spec) } }));
    expect(pkg.openInKalam).toMatch(/^kalam:\/\/import#k1\./);
    await client.close();
  });

  it('turns bad input into a tool error, not a crash', async () => {
    const client = await connect(createKalamServer());
    const wrongType = await client.callTool({ name: 'kalam_check_formula', arguments: { formula: 42 } });
    expect(wrongType.isError).toBe(true);
    const tooLong = await client.callTool({ name: 'kalam_check_formula', arguments: { formula: 'x'.repeat(301) } });
    expect(tooLong.isError).toBe(true);
    const unknownTemplate = await client.callTool({ name: 'kalam_build_from_template', arguments: { templateId: 'rocket' } });
    expect(unknownTemplate.isError).toBe(true);
    const invalidSpec = await client.callTool({ name: 'kalam_validate_spec', arguments: { spec: { id: 'x' } } });
    expect(invalidSpec.isError).toBeFalsy();
    expect(data(invalidSpec).ok).toBe(false);
    await client.close();
  });

  it('serves the schema, template and docs resources', async () => {
    const client = await connect(createKalamServer());
    const schema = await client.readResource({ uri: 'kalam://schema' });
    expect(JSON.parse(String(schema.contents[0]?.text)).title).toBe('KalamSpec 1.0.0');
    const listed = await client.listResources();
    expect(listed.resources.map((r) => r.uri)).toEqual(expect.arrayContaining(['kalam://schema', 'kalam://templates/counter']));
    const counter = JSON.parse(String((await client.readResource({ uri: 'kalam://templates/counter' })).contents[0]?.text));
    expect(counter.exampleSpec.schemaVersion).toBe('1.0.0');
    await expect(client.readResource({ uri: 'kalam://templates/rocket' })).rejects.toThrow();
    const docs = await client.readResource({ uri: 'kalam://docs/kalamspec' });
    expect(String(docs.contents[0]?.text)).toMatch(/KalamSpec/);
    await client.close();
  });

  it('offers the create_kalam_app prompt with the request fenced off', async () => {
    const client = await connect(createKalamServer());
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(['create_kalam_app']);
    const p = await client.getPrompt({ name: 'create_kalam_app', arguments: { request: 'a notes app' } });
    const body = p.messages[0]?.content.type === 'text' ? p.messages[0].content.text : '';
    expect(body).toContain('<request>\na notes app\n</request>');
    expect(body).toMatch(/kalam_validate_spec/);
    expect(body).not.toMatch(/—|!/);
    await client.close();
  });

  it('caps the size of tool arguments', async () => {
    const client = await connect(createKalamServer());
    const big = { spec: fixture('expense-tracker'), collection: 'expenses', records: Array.from({ length: 5001 }, () => ({ values: { amount: 1 } })) };
    const r = await client.callTool({ name: 'kalam_compute_report', arguments: big });
    expect(r.isError).toBe(true);
    await client.close();
  });
});
