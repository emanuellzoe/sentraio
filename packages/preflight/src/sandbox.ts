// near-workspaces 5 ships neard 2.6.2, which cannot load wasm built by current Rust /
// cargo-near (and lacks host functions current near-sdk links). Point its first-run
// download at a current neard instead. Has no effect if a binary is already installed.
export const SANDBOX_VERSION = '2.14.0';

const PLATFORMS: Record<string, string> = {
  'darwin-arm64': 'Darwin-arm64',
  'linux-x64': 'Linux-x86_64',
};

export function useCurrentSandbox(): void {
  if (process.env.SANDBOX_ARTIFACT_URL) return;
  const platform = PLATFORMS[`${process.platform}-${process.arch}`];
  if (!platform) return; // near-sandbox itself only supports these two
  process.env.SANDBOX_ARTIFACT_URL = `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/${platform}/${SANDBOX_VERSION}/near-sandbox.tar.gz`;
}
