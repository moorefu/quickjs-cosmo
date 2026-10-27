# Read after upstream's Makefile; add objects to every interpreter/compiler/SDK.
QJS_COMPAT_OBJS = $(OBJDIR)/qjs-host-exit.o $(OBJDIR)/qjs-host-process.o
QJS_COMPAT_OBJS += $(OBJDIR)/qjs-module-registry.o
ifneq ($(wildcard $(QJS_COSMO_COMPAT)/libc/intrin/sigproc.c),)
QJS_COMPAT_CFLAGS = -DQJS_COSMO_SIGPROC
endif
LDFLAGS += -Wl,--wrap=_Exit,-u,__wrap__Exit
qjs$(EXE) qjsc$(EXE) run-test262$(EXE) libquickjs.a: $(QJS_COMPAT_OBJS)

$(OBJDIR)/qjs-module-registry.o: $(QJS_COSMO_ROOT)/native/module_registry.c \
    $(QJS_COSMO_ROOT)/native/module_registry.h qjs-cosmo-config.h quickjs.h quickjs-libc.h | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE -I. -c -o $@ $<

$(OBJDIR)/qjs-host-exit.o: $(QJS_COSMO_ROOT)/compat/host_exit.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -c -o $@ $<

$(OBJDIR)/qjs-host-process.o: $(QJS_COSMO_ROOT)/compat/host_process.c \
    $(wildcard $(QJS_COSMO_COMPAT)/libc/calls/*.c) \
    $(wildcard $(QJS_COSMO_COMPAT)/libc/intrin/*.c) \
    $(wildcard $(QJS_COSMO_COMPAT)/libc/proc/*.c) | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -std=gnu23 -D_COSMO_SOURCE $(QJS_COMPAT_CFLAGS) -I$(QJS_COSMO_COMPAT) -c -o $@ $<
