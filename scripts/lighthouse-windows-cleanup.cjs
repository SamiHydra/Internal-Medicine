// Chrome may keep a handle to its Lighthouse profile for a few milliseconds on
// Windows, making Lighthouse report EPERM after it has successfully generated
// the LHR. CI runs on Linux; this preload only prevents that local cleanup race
// from turning a valid measurement into a failed command.
if (process.platform === 'win32') {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const originalRmSync = fs.rmSync
  const lighthouseTempPrefix = path.join(os.tmpdir(), 'lighthouse.')

  fs.rmSync = function rmSyncWithLighthouseRetry(target, options) {
    try {
      return originalRmSync(target, {
        maxRetries: 5,
        retryDelay: 200,
        ...options,
      })
    } catch (error) {
      if (
        error &&
        error.code === 'EPERM' &&
        String(target).startsWith(lighthouseTempPrefix)
      ) {
        return
      }

      throw error
    }
  }
}
