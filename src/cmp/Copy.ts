

import { cmp, Code } from '../jostraca'


const Copy = cmp(function Copy(props: any, children: any) {
  const fs = props.ctx$.fs
  const name = props.name
  const from = props.from

  const fromStat = fs.statSync(from)

  if (fromStat.isFile()) {
    props.ctx$.node.kind = 'file'
    props.ctx$.node.name = props.name
    const content = fs.readFileSync(from).toString()
    Code(content)
  }
  else if (fromStat.isDirectory()) {
    props.ctx$.node.kind = 'copy'
    props.ctx$.node.name = props.name
    props.ctx$.node.from = from
  }
  else {
    throw new Error('Copy: invalid from: ' + from)
  }

})



export {
  Copy
}
