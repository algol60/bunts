import fs from 'fs';
import readline from 'readline';
import { Effect } from "effect"
import { open } from 'node:fs/promises';
import { withConsoleError } from 'effect/Logger';

function is2(words: readonly string[]): words is [string, string] {
    return words.length === 2;
}

/**
 * A type guard that checks if an array has a specific length.
 * T: The type of elements in the array.
 * N: The expected length (must be a number literal).
 */
function hasLength<T, N extends number>(
  arr: T[],
  length: N
): arr is T[] & { length: N } {
  return arr.length === length;
}

async function readLines(filePath: string, key: string): Promise<Effect.Effect<string, string>> {
  const file = await open(filePath);

  for await (const line of file.readLines()) {
    console.log(`--: ${line}`);
    if (line.trimStart().startsWith(key)) {
        const words = line.split('=', 2);
        // for (const w of words) {
        //     console.log(`*${w.trim()}*`);
        // }

        if (words.length>=2 && words[1]) {
            // return words[1].trim();
            return Effect.succeed(words[1].trim());
            // console.log(`>>${words[1].trim()}<<`)
        } else {
            return Effect.fail('No filepath');
            // console.log('?');
        }
    }
  }

  return Effect.fail('Key p12 not found');
}

async function processLineByLine() {
  const fileStream = fs.createReadStream('/tmp/tmp.txt');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity // Recognizes all instances of CR LF (\r\n) as a single line break
  });

  for await (const line of rl) {
    console.log(`--: ${line}`);
    if (line.trimStart().startsWith('p12')) {
        const words = line.split('=', 1);
        // for (const w of words) {
        //     console.log(`*${w.trim()}*`);
        // }

        if (words.length==2 && words[1]) {
            // return words[1].trim();
            return Effect.succeed(words[1].trim());
            // console.log(`>>${words[1].trim()}<<`)
        } else {
            return null;
            console.log('?');
        }
    }
  }

  return null;
}

// const p12 = await processLineByLine();
// const p12 = await readLines('/tmp/tmp.txt', 'p12');
const p12 = await readLines('/tmp/tmp.txt', 'p12');
console.log(`p12=${p12}.`);

const result = Effect.match(p12, {
    onSuccess: (value) => `p12=${value}.`,
    onFailure: (error) => `failure: ${error}`
});
Effect.runPromise(result).then(console.log);
