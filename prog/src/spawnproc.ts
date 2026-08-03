
function randStr(n: number): string {
  const s = '0123456789abcdef'
  return Array.from({length: n}, () =>s[Math.floor(Math.random()*s.length)]).join('')
}

console.log(`Path: ${import.meta.path}`)
console.log(`Url: ${import.meta.url}`)
console.log(`Exec: ${process.execPath}`)

const path = Bun.file('/tmp/log.log')
const rs = randStr(36)

const subproc = `${import.meta.dir}/subproc.sh`
const proc = Bun.spawn([subproc, rs], {
  stdout: path,
  stderr: path
})
console.log(proc)

for await (const line of console) {
 console.log(`> ${line}`)
 break
}

proc.kill()
console.log('a')
await proc.exited
console.log(`${proc.exitCode} ${proc.signalCode}`)
