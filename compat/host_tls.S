/* The checksum-locked Nightly TLS getter fix also travels in the SDK. */
#ifdef __x86_64__
#include "libc/sysv/tlsasm.S"
#endif
.text
.globl qjs_cosmo_host_tls_link
qjs_cosmo_host_tls_link:
ret
