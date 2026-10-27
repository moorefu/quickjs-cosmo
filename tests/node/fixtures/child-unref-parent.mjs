import {spawn} from 'node:child_process';
const executable=process.env.NODE_COMPAT_CHILD_EXECUTABLE,fixture=process.env.QJS_UNREF_SCRIPT,marker=process.env.QJS_UNREF_MARKER;
const child=spawn(executable,[fixture,'marker',marker],{stdio:'ignore',windowsHide:true});
child.on('error',error=>{console.error(error.code,error.message);process.exitCode=1;});child.unref();
