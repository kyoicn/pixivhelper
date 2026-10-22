// Await-point instrumentation for SW restart tests (design-test-harness.md "Restart simulation").
// Call sites guard every call with `if (__TEST_HOOKS__)`, so shipped builds tree-shake this module.

/** Returning a promise that never settles freezes the caller at that await point ("SW died here"). */
export type TestHookHandler = (name: string) => void | Promise<void>;

// Kept on globalThis, not in module state, so a handler survives `vi.resetModules()` and the
// re-imported SW reports to the same test.
interface HookGlobal {
  __hfpTestHook?: TestHookHandler;
}
const hookGlobal = globalThis as HookGlobal;

export function setTestHookHandler(handler: TestHookHandler | null): void {
  if (handler) hookGlobal.__hfpTestHook = handler;
  else delete hookGlobal.__hfpTestHook;
}

/** Reports the await point `name` (`await:<where>`) to the installed handler; a no-op otherwise. */
export function __testHook(name: string): void | Promise<void> {
  if (!__TEST_HOOKS__) return;
  return hookGlobal.__hfpTestHook?.(name);
}
