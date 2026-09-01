# Packaged Python Runtime Resources

The Instagram, YouTube, and X collectors will run from one bundled Python
environment. The application must not fall back to a Python installation found
on the customer's machine.

During development the bundle belongs at `runtime/python`. In a packaged
application it belongs at `resources/python-runtime` beside the application
resources. `lib/runtime/python-runtime-manifest.json` is the source of truth
for the required files and the executable location for Windows, macOS, and
Linux.

Before starting a Python worker, the main process must call
`verifyPythonRuntime()`. A missing interpreter, dependency lock file, or worker
script is a startup error that should be shown to the user with a repair or
reinstall action; it must not silently use a system interpreter.

The final runtime bundle must contain:

- the platform-specific Python executable declared by the manifest;
- `requirements.lock`, including the selected package versions and wheel
  hashes;
- one worker script each for Instagram, YouTube, and X; and
- only the libraries required by those worker scripts.

Each worker communicates through the app's versioned JSONL protocol. It may
write protocol events to standard output, while diagnostics belong on standard
error. Credentials and session values must never be placed in the runtime
manifest, dependency lock file, or diagnostic output.
