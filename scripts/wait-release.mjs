const tag = process.argv[2]
const repo = 'Kuba0734/0x-Browser'
const api = (path) =>
  fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Accept: 'application/vnd.github+json' }
  }).then((response) => (response.ok ? response.json() : null))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) {
  console.error('Usage: node scripts/wait-release.mjs vX.Y.Z')
  process.exit(1)
}

const deadline = Date.now() + 30 * 60_000
let last = ''
while (Date.now() < deadline) {
  const runs = await api('actions/runs?per_page=10').catch(() => null)
  const run = runs?.workflow_runs?.find((entry) => entry.head_branch === tag)
  const status = run ? `${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}` : 'waiting'
  if (status !== last) console.log(`Build ${tag}: ${status}`)
  last = status
  if (run?.status === 'completed') {
    if (run.conclusion !== 'success') {
      console.error(`Build failed: ${run.html_url}`)
      process.exit(1)
    }
    const release = await api(`releases/tags/${tag}`).catch(() => null)
    if (!release || release.draft) {
      console.error(`Build succeeded, but no published release found: ${run.html_url}`)
      process.exit(1)
    }
    console.log(`Release published: ${release.html_url}`)
    for (const asset of release.assets) console.log(`  ${asset.name}`)
    process.exit(0)
  }
  await sleep(20_000)
}
console.error(`Timed out waiting for ${tag}: https://github.com/${repo}/actions`)
process.exit(1)
