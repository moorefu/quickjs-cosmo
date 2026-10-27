function inspectValue(value, seen = new Set(), depth = 2) {
    if (typeof value === 'string') return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r') + "'";
    if (typeof value === 'bigint') return value + 'n';
    if (value === null || typeof value !== 'object') return String(value);
    if (value instanceof Error) return value.stack || String(value);
    if (Buffer.isBuffer(value)) return '<Buffer' + (value.length ? ' ' + value.toString('hex').match(/../g).join(' ') : '') + '>';
    if (seen.has(value)) return '[Circular]';
    if (depth < 0) return Array.isArray(value) ? '[Array]' : '[Object]';
    seen.add(value);
    let text;
    if (Array.isArray(value)) text = value.length ? '[ ' + value.map(item => inspectValue(item, seen, depth - 1)).join(', ') + ' ]' : '[]';
    else {
        const parts = Object.keys(value).map(key => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : inspectValue(key)) + ': ' + inspectValue(value[key], seen, depth - 1));
        text = parts.length ? '{ ' + parts.join(', ') + ' }' : '{}';
    }
    seen.delete(value);
    return text;
}
function formatConsole(...args) {
    if (!args.length) return '';
    if (typeof args[0] !== 'string') return args.map(value => typeof value === 'string' ? value : inspectValue(value)).join(' ');
    if (args.length === 1) return args[0];
    let position = 1;
    const formatted = args[0].replace(/%[sdifjoOc%]/g, code => {
        if (code === '%%') return '%';
        if (position >= args.length) return code;
        const value = args[position++];
        if (code === '%c') return '';
        if (code === '%s') return value !== null && typeof value === 'object' ? inspectValue(value) : String(value);
        if (code === '%d') return typeof value === 'bigint' ? value + 'n' : typeof value === 'symbol' ? 'NaN' : String(Number(value));
        if (code === '%i') return typeof value === 'bigint' ? value + 'n' : typeof value === 'symbol' ? 'NaN' : String(parseInt(value, 10));
        if (code === '%f') return typeof value === 'symbol' ? 'NaN' : String(parseFloat(value));
        if (code === '%j') { try { return JSON.stringify(value); } catch { return '[Circular]'; } }
        return inspectValue(value);
    });
    return formatted + args.slice(position).map(value => ' ' + (typeof value === 'string' ? value : inspectValue(value))).join('');
}
function createConsole(native) {
    const console = {};
    for (const name of ['log', 'info', 'debug']) console[name] = (...args) => native.stdout(formatConsole(...args) + '\n');
    for (const name of ['error', 'warn']) console[name] = (...args) => native.stderr(formatConsole(...args) + '\n');
    console.dir = (value, options = {}) => native.stdout(inspectValue(value, new Set(), options.depth ?? 2) + '\n');
    console.assert = (value, ...args) => { if (!value) native.stderr('Assertion failed' + (args.length ? ': ' + formatConsole(...args) : '') + '\n'); };
    console.trace = (...args) => native.stderr((new Error('Trace: ' + formatConsole(...args))).stack + '\n');
    return console;
}
