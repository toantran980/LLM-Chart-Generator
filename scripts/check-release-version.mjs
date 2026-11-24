import { readFile } from 'node:fs/promises';

const packageFiles = ['package.json', 'client/package.json', 'server/package.json'];
const packages = await Promise.all(packageFiles.map(async (file) => {
  const manifest = JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  return { file, name: manifest.name, version: manifest.version };
}));

const versions = new Set(packages.map(({ version }) => version));
if (versions.size !== 1) {
  throw new Error(`Release package versions must match: ${packages.map(({ file, version }) => `${file}=${version}`).join(', ')}`);
}

// GitHub sets GITHUB_REF_NAME for branches as well as tags (for example,
// "main" on pushes to the default branch). Only compare it with package
// versions when this workflow is running for an actual tag.
const refType = process.env.GITHUB_REF_TYPE;
const fullRef = process.env.GITHUB_REF;
const tag = refType === 'tag'
  ? process.env.GITHUB_REF_NAME
  : fullRef?.startsWith('refs/tags/')
    ? fullRef.slice('refs/tags/'.length)
    : undefined;

if (tag) {
  const tagVersion = tag.replace(/^v/, '');
  const packageVersion = packages[0].version;
  if (tagVersion !== packageVersion) {
    throw new Error(`Release tag ${tag} does not match package version ${packageVersion}.`);
  }
}

console.log(`Release versions are aligned at ${packages[0].version}${tag ? ` (${tag})` : ''}.`);
