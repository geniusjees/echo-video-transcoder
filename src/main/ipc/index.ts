import { registerConfigIpc } from './config.ipc';
import { registerConcatIpc } from './concat.ipc';
import { registerFilesIpc } from './files.ipc';
import { registerHardwareIpc } from './hardware.ipc';
import { registerMediaIpc } from './media.ipc';
import { registerQueueIpc } from './queue.ipc';
import { registerSimpleIpc } from './simple.ipc';
import { registerTaskIpc } from './task.ipc';

/** 注册全部 IPC 通道（§12） */
export function registerAllIpc(): void {
  registerConfigIpc();
  registerHardwareIpc();
  registerMediaIpc();
  registerFilesIpc();
  registerQueueIpc();
  registerSimpleIpc();
  registerConcatIpc();
  registerTaskIpc();
}
