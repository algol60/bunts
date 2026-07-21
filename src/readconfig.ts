import fs from 'fs';
import readline from 'readline';

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

async function processLineByLine() {
  const fileStream = fs.createReadStream('/tmp/tmp.txt');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity // Recognizes all instances of CR LF (\r\n) as a single line break
  });

  for await (const line of rl) {
    console.log(`--: ${line}`);
    if (line.trimStart().startsWith('p12')) {
        const words = line.split('=', 2);
        // for (const w of words) {
        //     console.log(`*${w.trim()}*`);
        // }

        if (words.length==2 && words[1]!=undefined) {
            return words[1].trim();
            // console.log(`>>${words[1].trim()}<<`)
        } else {
            return null;
            console.log('?');
        }
    }
  }

  return null;
}

const p12 = await processLineByLine();
console.log(`p12=${p12}.`);
