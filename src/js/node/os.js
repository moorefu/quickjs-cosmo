function createOs(native, process, path) {
    const windows = native.platform === 'win32';
    const os = {
        platform: () => native.platform,
        arch: () => native.arch,
        hostname: () => native.hostname(),
        release: () => native.release(),
        type: () => ({ win32: 'Windows_NT', darwin: 'Darwin', linux: 'Linux', freebsd: 'FreeBSD',
                      openbsd: 'OpenBSD', netbsd: 'NetBSD' })[native.platform],
        tmpdir() {
            const env = process.env;
            let directory = windows ? env.TEMP || env.TMP || (env.SystemRoot || env.windir) + '\\temp' :
                env.TMPDIR || env.TMP || env.TEMP || '/tmp';
            if (windows) {
                if (directory.length > 1 && directory.endsWith('\\') && !/^[A-Za-z]:\\$/.test(directory)) directory = directory.slice(0, -1);
            } else if (directory.length > 1 && directory.endsWith('/')) directory = directory.slice(0, -1);
            return directory;
        },
        homedir() { return (windows ? process.env.USERPROFILE : process.env.HOME) || native.homedir(); },
        EOL: windows ? '\r\n' : '\n'
    };
    return os;
}
