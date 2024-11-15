
const Fs = require('node:fs')
const { Jostraca, getx, each, Folder, Inject, Content } = require('..')
const Parser = require('oxc-parser')

const utilitySrcPath = __dirname+'/../src/types.ts' 
const sourceText = Fs.readFileSync(utilitySrcPath,'utf8')
const options = {
  sourceFilename: utilitySrcPath,
}

let pres = Parser.parseSync(sourceText, options)
let ast = pres.program

// console.dir(ast,{depth:3})

let optionDefs = getx(ast, 'body?id:name==JostracaOptions 0 typeAnnotation members')
    .map(od=>({
      name: getx(od,'key.name'),
      type: getx(od,'typeAnnotation.typeAnnotation.type').replace(/TS|Keyword/g,'').toLowerCase()
    }))



const jostraca = Jostraca()

jostraca.generate(
  {
  folder: __dirname+'/..' },
  () => {
    Folder({ name: '.' }, () => {
      Inject(
        {
          name: 'README.md',
          markers:['<!--START-OPTIONS-->\n','\n<!--END-OPTIONS-->'],
          exclude: false
        },
        () => {
          each(optionDefs, (od)=>{
            Content(`
* __${od.name}__: \`${od.type}\``)
          })
      })
    })
  }
)
        

