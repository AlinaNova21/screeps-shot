const { ScreepsAPI } = require('screeps-api')
const { send } = require('micro')
const fs = require('fs')
const util = require('util')
// const crypto = require('crypto')
const Canvas = require('canvas')
const axios = require('axios')
const Stream = require('./stream')
const randomColor = require('randomcolor')
const imgCache = {}
const apiCache = {}
const roomCache = {}

const colors = {
    2: '#FF0000', // invader
    3: '#FF0000', // source keeper
    w: '#555555', // wall
    r: '#CCCCCC', // road
    pb: '#FFFFFF', // powerbank
    p: '#0000FF', // portal
    s: '#FAFA00', // source
    m: '#00FF00', // mineral
    c: '#777777', // controller
    k: '#FF0000', // keeperLair
}

const config = {
  register: true,
  protocol: 'http',
  hostname: 'botarena.screepspl.us',
  port: 21025,
  path: '/',
  username: 'CaptureBot',
  email: 'CaptureBot',
  password: 'CaptureBot'
}

const readFile = util.promisify(fs.readFile)
// const writeFile = util.promisify(fs.writeFile)
// const randomBytes = util.promisify(crypto.randomBytes)

// setPassword().then(()=>{}).catch(()=>{})

// async function setPassword() {
//   try {
//     let pw = await readFile('./pw')
//     config.password = pw
//   } catch () {
//     const pw = randomBytes(8).toString(16)
//     config.password = pw
//     await writeFile('./pw', pw)
//   }
// }

function getColor(identifier) {
    if (!colors[identifier]) {
        colors[identifier] = randomColor({
            luminosity: 'bright',
            seed: identifier,
        })
    }
    return colors[identifier]
}

function getMapImageUrl(room) {
  return `${config.protocol}://${config.hostname}:${config.port}/assets/map/${room}.png`
}

async function getMapImage(room) {
  if(imgCache[room]) return imgCache[room]
  const url = await getMapImageUrl(room)
  const data = await axios.get(url, { responseType: 'arraybuffer' })
  const img = new Canvas.Image()
  img.src = data.data
  imgCache[room] = img
  return img
}

module.exports = async (req, res) => {
  if(req.url.match('favico')) return ''
  let [,proto,hostname,port,mode = 'image'] = req.url.split('/')
  if(!proto || !hostname || !port) {
    res.setHeader('content-type','text/html')
    return `
    URL must be in the form of /proto/hostname/port. 
    ex: <a href="/http/botarena.screepspl.us/21025">/http/botarena.screepspl.us/21025</a>
    you can view a live-updating view by appending /viewer
    ex: <a href="/http/botarena.screepspl.us/21025/viewer">/http/botarena.screepspl.us/21025/viewer</a>
    `
  }

  if(mode === 'stream') {
    let s = new Stream(req, res)
    let handler = async () => {
      let frame = await captureMap({ proto, hostname, port })
      frame = 'data:image/png;base64,' + frame.toString('base64')
      s.send('frame', frame)
    }
    await handler()
    let cnt = 0
    let api = apiCache[hostname]
    api.socket.on('roomMap2:W10N10', handler)
    res.on('end', () => {
      console.log('detach')
      api.socket.off('roomMap2:W10N10', handler)
    })
    console.log('return')
    return undefined
    // return new Promise(() => {})
  }
  if(mode === 'viewer') {
    res.setHeader('content-type', 'text/html')
    return await readFile('./static/viewer.html', 'utf8')
  }
  if(mode === 'image') {
    // await api.raw.
    console.log(req.headers)
    if (req.headers['if-none-match'] === etag()) {
      return send(res, 304, 'Not Modified')
    }
    res.setHeader('content-type','image/png')
    // res.setHeader('cache-control','max-age=10')
    // res.setHeader('etag', etag())
    return captureMap({ proto, hostname, port })
  }
}

function etag() {
  return Math.round(Date.now() / 5000).toString(36).slice(2)
}

async function captureMap (opts) {
  for(let y = 0; y < 11; y++) {
    for(let x = 0; x < 11; x++) {
      getMapImage(`W${x}N${y}`)
    }
  }
  let api = apiCache[opts.hostname]
  if (!api || api.socket.readyState !== api.socket.OPEN) {
    console.log(`Connecting to ${opts.hostname}`)
    api = apiCache[opts.hostname] = new ScreepsAPI()
    api.setServer(Object.assign({}, config, opts))
    if (config.register) {
      console.log('register')
      await api.raw.register.submit(config.username, config.email, config.password, { main: '' })
    }
    console.log('auth')
    console.log(await api.auth())
    console.log('connect')
    await api.socket.connect()
    roomCache[opts.hostname] = {}
    let rooms = []
    for(let y = 0; y < 11; y++) {
      for(let x = 0; x < 11; x++) {
        let room = `W${x}N${y}`
        api.socket.send(`subscribe roomMap2:${room}`)
        rooms.push(new Promise((resolve,reject) => {
          api.socket.once(`roomMap2:${room}`, () => resolve())
        }))
      }  
    }
    api.socket.on(`roomMap2`, ({ id, data }) => {
      roomCache[opts.hostname][id] = data
    })
    console.log('Waiting for events...')
    await Promise.all(rooms)
  }
  console.log('renderMap')
  let canvas = await renderMap(roomCache[opts.hostname])
  console.log('returnBuffer')
  return canvas.toBuffer()
}

async function renderMap(rooms) {
  const DIM = 11 * 50 //9 * 50
  const canvas = new Canvas(DIM, DIM)
  const ctx = canvas.getContext('2d')
  for(let k in rooms) {
    await renderRoom(ctx, k, rooms[k])
  }
  return canvas
}

async function renderRoom(ctx, room, data) {
  let [,rx,ry] = room.match(/^[EW](\d+)[NS](\d+)$/)
  let bx = (10 - rx) * 50
  let by = (10 - ry) * 50

  let img = await getMapImage(room)
  ctx.drawImage(img, bx, by, 50, 50)
  for(let k in data) {
    let arr = data[k]
    ctx.fillStyle = getColor(k)
    arr.forEach(([x,y]) => {
      ctx.beginPath()
      ctx.rect(bx + x, by + y, 1, 1)
      ctx.fill()
    })
  }
}

// captureMap()
