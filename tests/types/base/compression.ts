import zlib from 'node:zlib';
import compression from 'cosmo:compression';
// @ts-expect-error Zstandard belongs to full.
zlib.zstdCompressSync('x');
// @ts-expect-error Zstandard streams belong to full.
zlib.createZstdDecompress();
// @ts-expect-error Zstandard constants belong to full.
zlib.constants.ZSTD_c_compressionLevel;
// @ts-expect-error LZ4 Frame belongs to full.
compression.lz4CompressSync('x');
// @ts-expect-error bzip2 belongs to full.
compression.bzip2Compress('x',()=>{});
// @ts-expect-error codec names describe linked backends only.
compression.codecInfo('lz4');
