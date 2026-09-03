import { spawn } from "node:child_process";

interface PythonRunResult {
  stdout: string;
  stderr: string;
}

export async function runPythonScript(scriptPath: string, args: string[], input?: string): Promise<PythonRunResult> {
  const pythonCommand = process.env.PYTHON_BIN || "python";

  return new Promise<PythonRunResult>((resolve, reject) => {
    const childEnv = {
      ...process.env,
      PYTHONIOENCODING: process.env.PYTHONIOENCODING ?? "utf-8",
    };
    const child = spawn(pythonCommand, [scriptPath, ...args], {
      env: childEnv,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });

    child.on("error", (error) => {
      reject(new Error(`Python process failed to start: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Python script exited with code ${code}. ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}
