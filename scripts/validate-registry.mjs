#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const KIND = 'orpad.nodePackRegistry';
const SCHEMA_VERSION = '1.0';
const OFFICIAL_REGISTRY_ID = 'orpad.official';
const OFFICIAL_SUBMISSIONS_URL = 'https://github.com/OrPAD-Lab/orpad-registry/pulls';
const OFFICIAL_REVIEW_POLICY_URL = 'https://github.com/OrPAD-Lab/orpad-registry/blob/main/REGISTRY_POLICY.md';
const REGISTRY_BYTE_LIMIT = 1024 * 1024;
const REGISTRY_ENTRY_LIMIT = 1000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,190}$/;
const SAFE_SHA256 = /^[a-f0-9]{64}$/i;

function usage() {
  return [
    'Usage:',
    '  node scripts/validate-registry.mjs [registry-json] [--json] [--allow-unapproved]',
    '',
    'Defaults to registry/packages.json and enforces the official OrPAD-Lab registry policy.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--allow-unapproved') {
      args.allowUnapproved = true;
      continue;
    }
    args._.push(arg);
  }
  return args;
}

function diagnostic(level, code, message, details = {}) {
  return { level, code, message, ...details };
}

function error(code, message, details = {}) {
  return diagnostic('error', code, message, details);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (isPlainObject(value)) {
    const next = {};
    for (const key of Object.keys(value).sort()) next[key] = stableJsonValue(value[key]);
    return next;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableJsonValue(value));
}

function valueKind(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function stringField(value, fieldPath, diagnostics, code, label) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    diagnostics.push(error(`${code}_MISSING`, `${label} is required.`, { path: fieldPath }));
    return '';
  }
  if (typeof value !== 'string') {
    diagnostics.push(error(`${code}_INVALID`, `${label} must be a string.`, {
      path: fieldPath,
      valueType: valueKind(value),
    }));
    return '';
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateId(value, fieldPath, diagnostics, code, label) {
  const text = stringField(value, fieldPath, diagnostics, code, label);
  if (text && !SAFE_ID.test(text)) {
    diagnostics.push(error(`${code}_INVALID`, `${label} must be a safe id segment.`, {
      path: fieldPath,
      value: text,
    }));
    return '';
  }
  return text;
}

function validateHttpsUrl(value, fieldPath, diagnostics, code, label) {
  const text = stringField(value, fieldPath, diagnostics, code, label);
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    diagnostics.push(error(`${code}_UNSAFE`, `${label} must be a valid HTTPS URL.`, {
      path: fieldPath,
      value: text,
      reason: 'url-parse-failed',
    }));
    return text;
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    diagnostics.push(error(`${code}_UNSAFE`, `${label} must use HTTPS and must not include credentials.`, {
      path: fieldPath,
      value: text,
    }));
  }
  return text;
}

function isSafePortablePath(value) {
  const text = String(value || '').replace(/\\/g, '/');
  return Boolean(text)
    && !text.startsWith('/')
    && !/^[A-Za-z]:\//.test(text)
    && !text.includes('//')
    && !text.split('/').some(part => part === '.' || part === '..' || !part);
}

function validatePortablePath(value, fieldPath, diagnostics, code, label, required = true) {
  const text = required
    ? stringField(value, fieldPath, diagnostics, code, label)
    : optionalString(value);
  if (text && !isSafePortablePath(text)) {
    diagnostics.push(error(`${code}_UNSAFE`, `${label} must be repository-relative and portable.`, {
      path: fieldPath,
      value: text,
    }));
  }
  return text;
}

function validateStringList(value, fieldPath, diagnostics, code, label, required = false) {
  if (value === undefined || value === null) {
    if (required) diagnostics.push(error(`${code}_MISSING`, `${label} is required.`, { path: fieldPath }));
    return [];
  }
  if (!Array.isArray(value)) {
    diagnostics.push(error(`${code}_INVALID`, `${label} must be an array of strings.`, {
      path: fieldPath,
      valueType: valueKind(value),
    }));
    return [];
  }
  return value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
}

function validateSha256(value, fieldPath, diagnostics, code, label) {
  const text = optionalString(value);
  if (!SAFE_SHA256.test(text)) {
    diagnostics.push(error(code, `${label} must be a SHA-256 hex string.`, {
      path: fieldPath,
      value: text,
    }));
  }
  return text;
}

function validateGovernance(registry, diagnostics) {
  const governance = isPlainObject(registry.governance) ? registry.governance : {};
  const submissions = isPlainObject(governance.submissions) ? governance.submissions : {};
  if (registry.registryId !== OFFICIAL_REGISTRY_ID) {
    diagnostics.push(error('ORPAD_REGISTRY_ID_INVALID', 'Official registry id must remain orpad.official.', {
      path: 'registryId',
      expected: OFFICIAL_REGISTRY_ID,
      actual: registry.registryId || '',
    }));
  }
  if (governance.registryTrust !== 'official') {
    diagnostics.push(error('ORPAD_REGISTRY_TRUST_INVALID', 'Official registry governance must declare registryTrust=official.', {
      path: 'governance.registryTrust',
      actual: governance.registryTrust || '',
    }));
  }
  if (governance.reviewModel !== 'orpad-pr-reviewed') {
    diagnostics.push(error('ORPAD_REGISTRY_REVIEW_MODEL_INVALID', 'Official registry governance must use orpad-pr-reviewed.', {
      path: 'governance.reviewModel',
      actual: governance.reviewModel || '',
    }));
  }
  if (submissions.type !== 'pull-request' || submissions.url !== OFFICIAL_SUBMISSIONS_URL) {
    diagnostics.push(error('ORPAD_REGISTRY_SUBMISSIONS_INVALID', 'Official registry submissions must route through OrPAD-Lab/orpad-registry pull requests.', {
      path: 'governance.submissions.url',
      expected: OFFICIAL_SUBMISSIONS_URL,
      actual: submissions.url || '',
    }));
  }
  if (governance.reviewPolicyUrl !== OFFICIAL_REVIEW_POLICY_URL) {
    diagnostics.push(error('ORPAD_REGISTRY_POLICY_URL_INVALID', 'Official registry review policy URL must point at OrPAD-Lab/orpad-registry.', {
      path: 'governance.reviewPolicyUrl',
      expected: OFFICIAL_REVIEW_POLICY_URL,
      actual: governance.reviewPolicyUrl || '',
    }));
  }
}

function validateVersion(rawVersion, entryId, entryPath, diagnostics, options) {
  if (!isPlainObject(rawVersion)) {
    diagnostics.push(error('NODE_PACK_REGISTRY_VERSION_INVALID', 'Registry entry version must be an object.', {
      path: entryPath,
      valueType: valueKind(rawVersion),
      entryId,
    }));
    return null;
  }
  const version = stringField(rawVersion.version, `${entryPath}.version`, diagnostics, 'NODE_PACK_REGISTRY_VERSION', 'Version');
  validateHttpsUrl(rawVersion.manifestUrl, `${entryPath}.manifestUrl`, diagnostics, 'NODE_PACK_REGISTRY_MANIFEST_URL', 'Manifest URL');
  validateHttpsUrl(rawVersion.sourceRepository, `${entryPath}.sourceRepository`, diagnostics, 'NODE_PACK_REGISTRY_SOURCE_REPOSITORY', 'Source repository');
  stringField(rawVersion.sourceRef, `${entryPath}.sourceRef`, diagnostics, 'NODE_PACK_REGISTRY_SOURCE_REF', 'Source ref');
  validatePortablePath(rawVersion.manifestPath, `${entryPath}.manifestPath`, diagnostics, 'NODE_PACK_REGISTRY_MANIFEST_PATH', 'Manifest path');
  validatePortablePath(rawVersion.sourceRoot, `${entryPath}.sourceRoot`, diagnostics, 'NODE_PACK_REGISTRY_SOURCE_ROOT', 'Source root', false);

  const checksums = isPlainObject(rawVersion.checksums) ? rawVersion.checksums : {};
  validateSha256(checksums.manifestSha256, `${entryPath}.checksums.manifestSha256`, diagnostics, 'ORPAD_REGISTRY_MANIFEST_SHA256_INVALID', 'Manifest checksum');
  const files = isPlainObject(checksums.files) ? checksums.files : {};
  for (const [filePath, sha256] of Object.entries(files)) {
    validateSha256(sha256, `${entryPath}.checksums.files.${filePath}`, diagnostics, 'ORPAD_REGISTRY_FILE_SHA256_INVALID', 'File checksum');
  }

  const review = isPlainObject(rawVersion.review) ? rawVersion.review : {};
  if (!options.allowUnapproved) {
    if (review.status !== 'approved') {
      diagnostics.push(error('ORPAD_REGISTRY_VERSION_NOT_APPROVED', 'Official registry versions must carry maintainer-approved review metadata before merge.', {
        path: `${entryPath}.review.status`,
        entryId,
        version,
      }));
    }
    for (const field of ['reviewId', 'reviewedBy', 'reviewedAt']) {
      if (!String(review[field] || '').trim()) {
        diagnostics.push(error('ORPAD_REGISTRY_REVIEW_METADATA_MISSING', `Official registry approved versions must include review.${field}.`, {
          path: `${entryPath}.review.${field}`,
          entryId,
          version,
        }));
      }
    }
    validateStringList(review.approvedCapabilities, `${entryPath}.review.approvedCapabilities`, diagnostics, 'ORPAD_REGISTRY_APPROVED_CAPABILITIES', 'Approved capabilities', true);
  }

  return { version };
}

function validateEntry(rawEntry, index, diagnostics, options) {
  const entryPath = `entries[${index}]`;
  if (!isPlainObject(rawEntry)) {
    diagnostics.push(error('NODE_PACK_REGISTRY_ENTRY_INVALID', 'Registry entry must be an object.', {
      path: entryPath,
      valueType: valueKind(rawEntry),
    }));
    return null;
  }
  const id = validateId(rawEntry.id, `${entryPath}.id`, diagnostics, 'NODE_PACK_REGISTRY_ENTRY_ID', 'Entry id');
  stringField(rawEntry.name, `${entryPath}.name`, diagnostics, 'NODE_PACK_REGISTRY_ENTRY_NAME', 'Entry name');
  const latestVersion = stringField(rawEntry.latestVersion, `${entryPath}.latestVersion`, diagnostics, 'NODE_PACK_REGISTRY_ENTRY_LATEST_VERSION', 'Latest version');
  if (!isPlainObject(rawEntry.author)) {
    diagnostics.push(error('ORPAD_REGISTRY_ENTRY_AUTHOR_MISSING', 'Registry entries must include author metadata.', {
      path: `${entryPath}.author`,
      entryId: id,
    }));
  }
  stringField(rawEntry.license, `${entryPath}.license`, diagnostics, 'ORPAD_REGISTRY_ENTRY_LICENSE', 'License');
  validateStringList(rawEntry.capabilities, `${entryPath}.capabilities`, diagnostics, 'ORPAD_REGISTRY_ENTRY_CAPABILITIES', 'Capabilities', true);
  validateStringList(rawEntry.nodeTypes || rawEntry.declaredNodeTypes, `${entryPath}.nodeTypes`, diagnostics, 'ORPAD_REGISTRY_ENTRY_NODE_TYPES', 'Node types', true);

  if (!Array.isArray(rawEntry.versions) || !rawEntry.versions.length) {
    diagnostics.push(error('NODE_PACK_REGISTRY_ENTRY_VERSIONS_MISSING', 'Registry entry must contain at least one version.', {
      path: `${entryPath}.versions`,
      entryId: id,
    }));
    return { id, versions: [] };
  }
  const versionSeen = new Set();
  const versions = [];
  for (const [versionIndex, rawVersion] of rawEntry.versions.entries()) {
    const version = validateVersion(rawVersion, id, `${entryPath}.versions[${versionIndex}]`, diagnostics, options);
    if (!version?.version) continue;
    if (versionSeen.has(version.version)) {
      diagnostics.push(error('NODE_PACK_REGISTRY_VERSION_DUPLICATE', 'Registry entry declares the same version more than once.', {
        path: `${entryPath}.versions[${versionIndex}].version`,
        entryId: id,
        version: version.version,
      }));
    }
    versionSeen.add(version.version);
    versions.push(version);
  }
  if (latestVersion && !versionSeen.has(latestVersion)) {
    diagnostics.push(error('NODE_PACK_REGISTRY_LATEST_VERSION_MISSING', 'Registry latestVersion must match one declared version.', {
      path: `${entryPath}.latestVersion`,
      entryId: id,
      latestVersion,
    }));
  }
  return { id, versions };
}

function validateRegistry(registry, options = {}) {
  const diagnostics = [];
  if (!isPlainObject(registry)) {
    return {
      ok: false,
      diagnostics: [error('NODE_PACK_REGISTRY_INVALID', 'Registry index must be a JSON object.', {
        valueType: valueKind(registry),
      })],
    };
  }
  const kind = stringField(registry.kind, 'kind', diagnostics, 'NODE_PACK_REGISTRY_KIND', 'Registry kind');
  if (kind && kind !== KIND) {
    diagnostics.push(error('NODE_PACK_REGISTRY_KIND_INVALID', 'Registry kind is not supported.', {
      path: 'kind',
      expected: KIND,
      actual: kind,
    }));
  }
  const schemaVersion = stringField(registry.schemaVersion, 'schemaVersion', diagnostics, 'NODE_PACK_REGISTRY_SCHEMA_VERSION', 'Schema version');
  if (schemaVersion && schemaVersion !== SCHEMA_VERSION) {
    diagnostics.push(error('NODE_PACK_REGISTRY_SCHEMA_VERSION_INVALID', 'Registry schema version is not supported.', {
      path: 'schemaVersion',
      expected: SCHEMA_VERSION,
      actual: schemaVersion,
    }));
  }
  validateId(registry.registryId, 'registryId', diagnostics, 'NODE_PACK_REGISTRY_ID', 'Registry id');
  stringField(registry.name, 'name', diagnostics, 'NODE_PACK_REGISTRY_NAME', 'Registry name');
  validateGovernance(registry, diagnostics);
  if (!Array.isArray(registry.entries)) {
    diagnostics.push(error('NODE_PACK_REGISTRY_ENTRIES_MISSING', 'Registry entries must be an array.', {
      path: 'entries',
      valueType: valueKind(registry.entries),
    }));
  } else if (registry.entries.length > REGISTRY_ENTRY_LIMIT) {
    diagnostics.push(error('NODE_PACK_REGISTRY_ENTRIES_TOO_MANY', 'Registry entry count exceeds the safe parse limit.', {
      path: 'entries',
      entryCount: registry.entries.length,
      maxEntries: REGISTRY_ENTRY_LIMIT,
    }));
  }

  const entrySeen = new Set();
  for (const [index, rawEntry] of (Array.isArray(registry.entries) ? registry.entries : []).entries()) {
    const entry = validateEntry(rawEntry, index, diagnostics, options);
    if (!entry?.id) continue;
    if (entrySeen.has(entry.id)) {
      diagnostics.push(error('NODE_PACK_REGISTRY_ENTRY_DUPLICATE_ID', 'Registry declares the same package id more than once.', {
        path: `entries[${index}].id`,
        entryId: entry.id,
      }));
    }
    entrySeen.add(entry.id);
  }
  return {
    ok: !diagnostics.some(item => item.level === 'error'),
    diagnostics,
  };
}

async function readRegistry(filePath) {
  const targetPath = path.resolve(filePath);
  const stat = await fs.stat(targetPath);
  if (!stat.isFile()) {
    throw new Error(`Registry path is not a file: ${targetPath}`);
  }
  if (stat.size > REGISTRY_BYTE_LIMIT) {
    throw new Error(`Registry file exceeds ${REGISTRY_BYTE_LIMIT} bytes: ${targetPath}`);
  }
  const text = await fs.readFile(targetPath, 'utf-8');
  return {
    path: targetPath,
    registry: JSON.parse(text),
  };
}

async function aliasDiagnostics(registryPath, registry) {
  const diagnostics = [];
  const normalizedPath = path.resolve(registryPath).replace(/\\/g, '/');
  if (!normalizedPath.endsWith('/registry/packages.json')) return diagnostics;
  const aliasPath = path.resolve(path.dirname(registryPath), 'node-packs.json');
  let alias;
  try {
    alias = JSON.parse(await fs.readFile(aliasPath, 'utf-8'));
  } catch (err) {
    diagnostics.push(error('ORPAD_REGISTRY_COMPAT_ALIAS_MISSING', 'registry/node-packs.json compatibility alias must exist for shipped OrPAD builds.', {
      path: aliasPath,
      error: err.message,
    }));
    return diagnostics;
  }
  if (stableJson(alias) !== stableJson(registry)) {
    diagnostics.push(error('ORPAD_REGISTRY_COMPAT_ALIAS_DRIFT', 'registry/node-packs.json must match registry/packages.json until legacy OrPAD builds are retired.', {
      path: aliasPath,
    }));
  }
  return diagnostics;
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const entryCount = Array.isArray(result.registry?.entries) ? result.registry.entries.length : 0;
  process.stdout.write(`Registry validation ${result.success ? 'ok' : 'failed'}: ${result.path} (${entryCount} entries)\n`);
  for (const item of result.diagnostics || []) {
    const scope = [item.path, item.entryId, item.version].filter(Boolean).join(' ');
    process.stdout.write(`- ${item.level} ${item.code}${scope ? ` (${scope})` : ''}: ${item.message}\n`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const registryPath = args._[0] || 'registry/packages.json';
  const { path: resolvedPath, registry } = await readRegistry(registryPath);
  const validation = validateRegistry(registry, { allowUnapproved: args.allowUnapproved });
  const aliasIssues = await aliasDiagnostics(resolvedPath, registry);
  const diagnostics = [
    ...validation.diagnostics,
    ...aliasIssues,
  ];
  const success = validation.ok && !aliasIssues.some(item => item.level === 'error');
  const result = {
    success,
    ok: success,
    path: resolvedPath,
    registry: {
      registryId: registry?.registryId || '',
      name: registry?.name || '',
      entries: Array.isArray(registry?.entries) ? registry.entries.map(entry => ({
        id: entry?.id || '',
        name: entry?.name || '',
        latestVersion: entry?.latestVersion || '',
      })) : [],
    },
    diagnostics,
  };
  printResult(result, args.json);
  if (!success) process.exitCode = 1;
}

main().catch((err) => {
  const result = {
    success: false,
    ok: false,
    path: path.resolve(process.argv[2] || 'registry/packages.json'),
    registry: null,
    diagnostics: [error('ORPAD_REGISTRY_VALIDATE_FAILED', 'Registry validation could not complete.', {
      error: err.message,
    })],
  };
  const json = process.argv.includes('--json');
  printResult(result, json);
  process.exitCode = 1;
});
