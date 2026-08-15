const fs = require('node:fs/promises');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'public');
const outputDir = path.join(projectRoot, 'dist');
const aeoOutputDir = path.join(outputDir, 'aeo');

async function build() {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(aeoOutputDir, { recursive: true });
  await fs.cp(sourceDir, aeoOutputDir, { recursive: true });
  console.log(`Cloudflare assets built at ${aeoOutputDir}`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
