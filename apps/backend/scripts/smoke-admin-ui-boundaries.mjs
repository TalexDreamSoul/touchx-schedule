import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const appRoot = resolve(repoRoot, "apps/backend/app");
const nexusPagesRoot = resolve(appRoot, "pages/nexus");

const readSource = (relativePath) => {
  const absolutePath = resolve(repoRoot, relativePath);
  return {
    absolutePath,
    relativePath,
    source: readFileSync(absolutePath, "utf8"),
  };
};

const assertContains = (file, needle) => {
  assert.ok(file.source.includes(needle), `${file.absolutePath} must include ${needle}`);
};

const listVueFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return listVueFiles(absolutePath);
    }
    return extname(entry.name) === ".vue" ? [absolutePath] : [];
  });

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const directSharedClassDefinitionRegex = (className) =>
  new RegExp(`(^|\\n)\\s*(?::deep\\()?\\.${escapeRegex(className)}(?::[-\\w]+(?:\\([^)]*\\))?)?(?:\\))?\\s*(?:,|\\{)`);

const findMatchingLine = (source, pattern) => source.split(/\r?\n/).find((line) => pattern.test(line));

const shell = readSource("apps/backend/app/components/nexus/NexusAdminShell.vue");
const dashboard = readSource("apps/backend/app/components/nexus/NexusDashboard.vue");
const rootPage = readSource("apps/backend/app/pages/index.vue");
const backendPackage = readSource("apps/backend/package.json");
const verifyLocal = readSource("apps/backend/scripts/verify-v1-local.sh");

const sharedClasses = [
  "rx-btn",
  "rx-btn-ghost",
  "rx-card",
  "rx-card-head",
  "rx-grid",
  "rx-pill",
  "rx-table-wrap",
  "rx-table",
  "rx-muted",
];

sharedClasses.forEach((className) => assertContains(shell, className));

assert.ok(/<NexusAdminShell\b/.test(dashboard.source), `${dashboard.absolutePath} must render NexusAdminShell`);
assert.ok(/<NexusDashboard\b/.test(rootPage.source), `${rootPage.absolutePath} must render NexusDashboard`);

const authPageNames = new Set(["init.vue", "login.vue"]);
listVueFiles(nexusPagesRoot)
  .filter((absolutePath) => !authPageNames.has(basename(absolutePath)))
  .forEach((absolutePath) => {
    const source = readFileSync(absolutePath, "utf8");
    assert.ok(
      /<Nexus(?:AdminShell|Dashboard)\b/.test(source),
      `${absolutePath} must render NexusAdminShell or NexusDashboard`,
    );
  });

[
  "apps/backend/app/components/nexus/NexusConsole.vue",
  "apps/backend/app/components/NexusConsole.vue",
].forEach((relativePath) => {
  assert.ok(!existsSync(resolve(repoRoot, relativePath)), `${relativePath} must not return`);
});

const legacyComponentPatterns = [
  /import\s+NexusConsole\b/,
  /from\s+["'][^"']*NexusConsole(?:\.vue)?["']/,
  /<NexusConsole\b/,
  /\bcomponents\s*:\s*\{[^}]*\bNexusConsole\b/s,
];

listVueFiles(appRoot).forEach((absolutePath) => {
  const source = readFileSync(absolutePath, "utf8");
  legacyComponentPatterns.forEach((pattern) => {
    assert.ok(!pattern.test(source), `${absolutePath} must not import or render legacy NexusConsole`);
  });
});

listVueFiles(appRoot)
  .filter((absolutePath) => absolutePath !== shell.absolutePath)
  .forEach((absolutePath) => {
    const source = readFileSync(absolutePath, "utf8");
    sharedClasses.forEach((className) => {
      const pattern = directSharedClassDefinitionRegex(className);
      const matchingLine = findMatchingLine(source, pattern);
      assert.ok(
        !matchingLine,
        `${absolutePath} must not redefine .${className}; move shared styling to ${shell.relativePath}. Found: ${matchingLine}`,
      );
    });
  });

assertContains(backendPackage, "smoke:admin-ui-boundaries");
assertContains(verifyLocal, "smoke:admin-ui-boundaries");

const checkedPages = listVueFiles(nexusPagesRoot).length;
const checkedFiles = listVueFiles(appRoot).length;
console.log(
  `ok admin UI boundaries pages=${checkedPages} appFiles=${checkedFiles} shell=${relative(repoRoot, shell.absolutePath)}`,
);
