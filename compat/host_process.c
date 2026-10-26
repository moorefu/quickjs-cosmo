/* These files are the checksum-verified sources of the selected toolchain. */
#if defined(__x86_64__)
#include "libc/calls/ntspawn.c"
#include "libc/intrin/fds.c"
#include "libc/proc/wait4-nt.c"
#include "libc/intrin/terminatethisprocess.c"
#ifdef QJS_COSMO_SIGPROC
#include "libc/intrin/sigproc.c"
#endif
#endif

void qjs_cosmo_process_link(void) {}
