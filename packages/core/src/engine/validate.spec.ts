/**
 * The engine binary comes from a setting the window writes: the window must
 * never be able to choose a program to run (security rule 1). The name is the
 * one thing that can be checked before running it.
 */

import { describe, expect, it } from 'vitest';
import { assertLlamaBinary } from './validate.js';

describe('assertLlamaBinary — the engine is a llama.cpp server, not any program', () => {
  it.each([
    'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\llama.exe',
    'C:\\tools\\llama.cpp\\llama-server.exe',
    '/usr/local/bin/llama-server',
    'D:\\bin\\llama-server-cuda.exe',
    'llama',
  ])('accepts %s', (path) => {
    expect(() => assertLlamaBinary(path)).not.toThrow();
  });

  it.each([
    'C:\\Windows\\System32\\cmd.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    '/bin/sh',
    'C:\\Users\\me\\Downloads\\not-llama.exe',
    'C:\\tools\\llama.cmd',
    '',
  ])('refuses %s', (path) => {
    expect(() => assertLlamaBinary(path)).toThrow(/llama/);
  });

  it.each([
    'C:\\tools\\llama-server.cmd',
    'C:\\tools\\llama-server.bat',
    'C:\\tools\\llama-server.ps1',
    'C:\\tools\\llama_x.vbs',
    '/opt/llama-server.sh',
  ])('refuses a script that only borrows the name: %s', (path) => {
    expect(() => assertLlamaBinary(path)).toThrow(/llama/);
  });
});
