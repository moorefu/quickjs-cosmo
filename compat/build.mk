# Read after upstream's Makefile; add objects to every interpreter/compiler/SDK.
QJS_COMPAT_OBJS = $(OBJDIR)/qjs-host-exit.o $(OBJDIR)/qjs-host-process.o
QJS_COMPAT_OBJS += $(OBJDIR)/qjs-module-registry.o
QJS_COMPAT_OBJS += $(OBJDIR)/qjs-runtime-state.o
QJS_COMPAT_OBJS += $(OBJDIR)/qjs-tasks.o
QJS_COMPAT_OBJS += $(OBJDIR)/qjs-windows-host.o
QJS_COMPAT_OBJS += $(OBJDIR)/qjs-fs-sync.o
QJS_COMPAT_OBJS += $(OBJDIR)/qjs-fs-paths.o
QJS_COMPAT_OBJS += $(OBJDIR)/qjs-crypto.o
QJS_COMPAT_OBJS += $(OBJDIR)/qjs-compression.o
QJS_COMPAT_OBJS += $(OBJDIR)/qjs-child-process.o $(OBJDIR)/qjs-process-core.o $(OBJDIR)/qjs-process-posix.o $(OBJDIR)/qjs-process-windows.o
QJS_COSMO_NATIVE ?= $(shell python3 "$(QJS_COSMO_ROOT)/scripts/build_config.py" native_source)
ifneq ($(wildcard $(QJS_COSMO_COMPAT)/libc/intrin/sigproc.c),)
QJS_COMPAT_CFLAGS = -DQJS_COSMO_SIGPROC
endif
LDFLAGS += -Wl,--wrap=_Exit,-u,__wrap__Exit
qjs$(EXE) qjsc$(EXE) run-test262$(EXE) libquickjs.a: $(QJS_COMPAT_OBJS)

$(OBJDIR)/qjs-crypto.o: $(QJS_COSMO_ROOT)/build/native/crypto/qjs-crypto.o | $(OBJDIR)
	cp $< $@
	mkdir -p $(OBJDIR)/.aarch64
	cp $(QJS_COSMO_ROOT)/build/native/crypto/.aarch64/qjs-crypto.o $(OBJDIR)/.aarch64/

$(OBJDIR)/qjs-compression.o: $(QJS_COSMO_ROOT)/build/native/compression/qjs-compression.o | $(OBJDIR)
	cp $< $@
	mkdir -p $(OBJDIR)/.aarch64
	cp $(QJS_COSMO_ROOT)/build/native/compression/.aarch64/qjs-compression.o $(OBJDIR)/.aarch64/

$(OBJDIR)/qjs-module-registry.o: $(QJS_COSMO_ROOT)/native/module_registry.c \
    $(QJS_COSMO_ROOT)/native/module_registry.h $(QJS_COSMO_ROOT)/native/runtime_state.h qjs-cosmo-config.h qjs-builtins.h quickjs.h quickjs-libc.h | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE -I. -c -o $@ $<

$(OBJDIR)/qjs-tasks.o: $(QJS_COSMO_ROOT)/native/tasks.c $(QJS_COSMO_ROOT)/native/tasks.h $(QJS_COSMO_ROOT)/native/module_registry.h quickjs.h quickjs-libc.h | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE -I. -c -o $@ $<

$(OBJDIR)/qjs-child-process.o: $(QJS_COSMO_ROOT)/native/process/binding.c $(QJS_COSMO_ROOT)/native/process/binding.h $(QJS_COSMO_ROOT)/native/process/core.h quickjs.h | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE -I. -I$(QJS_COSMO_NATIVE) -c -o $@ $<

$(OBJDIR)/qjs-process-core.o: $(QJS_COSMO_ROOT)/native/process/core.c $(QJS_COSMO_ROOT)/native/process/core.h | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE -I. -c -o $@ $<

$(OBJDIR)/qjs-process-posix.o: $(QJS_COSMO_ROOT)/native/process/posix.c $(QJS_COSMO_ROOT)/native/process/core.h $(QJS_COSMO_NATIVE)/libc/proc/posix_spawn.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE -I. -I$(QJS_COSMO_COMPAT) -I$(QJS_COSMO_NATIVE) -c -o $@ $<

$(OBJDIR)/qjs-process-windows.o: $(QJS_COSMO_ROOT)/native/process/windows.c $(QJS_COSMO_ROOT)/native/process/core.h $(QJS_COSMO_COMPAT)/libc/calls/ntspawn.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE -I. -I$(QJS_COSMO_COMPAT) -I$(QJS_COSMO_NATIVE) -c -o $@ $<

$(OBJDIR)/qjs-runtime-state.o: $(QJS_COSMO_ROOT)/native/runtime_state.c \
    $(QJS_COSMO_ROOT)/native/runtime_state.h $(QJS_COSMO_ROOT)/native/common/windows_host.h $(QJS_COSMO_ROOT)/native/fs/sync.h $(QJS_COSMO_ROOT)/native/crypto/binding.h $(QJS_COSMO_ROOT)/native/compression/binding.h $(QJS_COSMO_ROOT)/native/process/binding.h $(QJS_COSMO_ROOT)/native/module_registry.h qjs-cosmo-config.h quickjs.h quickjs-libc.h | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE -I. -c -o $@ $<

$(OBJDIR)/qjs-fs-sync.o: $(QJS_COSMO_ROOT)/native/fs/sync.c $(QJS_COSMO_ROOT)/native/fs/sync.h $(QJS_COSMO_ROOT)/native/common/windows_host.h quickjs.h | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE -I. -c -o $@ $<

$(OBJDIR)/qjs-fs-paths.o: $(QJS_COSMO_ROOT)/native/fs/paths.c $(QJS_COSMO_ROOT)/native/fs/sync.h \
    $(QJS_COSMO_COMPAT)/libc/calls/openat.c $(QJS_COSMO_NATIVE)/libc/calls/mkdirat.c \
    $(QJS_COSMO_NATIVE)/libc/calls/renameat.c $(QJS_COSMO_NATIVE)/libc/calls/mkdtemp.c quickjs.h | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE -I. -I$(QJS_COSMO_COMPAT) -I$(QJS_COSMO_NATIVE) -c -o $@ $<

$(OBJDIR)/qjs-windows-host.o: $(QJS_COSMO_ROOT)/native/common/windows_host.c \
    $(QJS_COSMO_ROOT)/native/common/windows_host.h $(QJS_COSMO_ROOT)/native/module_registry.h quickjs.h | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE -I. -c -o $@ $<

$(OBJDIR)/qjs-host-exit.o: $(QJS_COSMO_ROOT)/compat/host_exit.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -c -o $@ $<

$(OBJDIR)/qjs-host-process.o: $(QJS_COSMO_ROOT)/compat/host_process.c \
    $(wildcard $(QJS_COSMO_COMPAT)/libc/calls/*.c) \
    $(wildcard $(QJS_COSMO_COMPAT)/libc/intrin/*.c) \
    $(wildcard $(QJS_COSMO_COMPAT)/libc/proc/*.c) | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE $(QJS_COMPAT_CFLAGS) -I$(QJS_COSMO_COMPAT) -c -o $@ $<
