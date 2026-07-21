/* Metro needs telling about @garage/shared.

   The package lives outside this app's directory (../packages/shared) and is
   linked in as a `file:` dependency, so node_modules/@garage/shared is a
   symlink. Metro does not follow a symlink out of the project root unless the
   target is in watchFolders, and it will not transpile TypeScript it cannot
   see — so without this the app fails to resolve @garage/shared at bundle time.

   Mobile is deliberately NOT an npm workspace. Hoisting its dependencies to the
   repo root would change the paths ios/Podfile resolves against, and that is not
   worth risking for tidiness. Keeping node_modules here means the native project
   is untouched by the monorepo layout. */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../packages/shared');

const config = getDefaultConfig(projectRoot);

// Let Metro read (and watch, so edits hot-reload) the shared package source.
config.watchFolders = [sharedRoot];

// Resolve dependencies from this app first, then the shared package's own tree.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(sharedRoot, 'node_modules'),
];

// react / react-native must resolve to ONE copy. The shared package declares
// @supabase/supabase-js as a peer dependency for the same reason: two copies of
// the client would mean two realtime connections and two auth sessions.
config.resolver.extraNodeModules = new Proxy(
  {},
  {
    get: (_, name) => path.resolve(projectRoot, 'node_modules', String(name)),
  },
);

module.exports = config;
