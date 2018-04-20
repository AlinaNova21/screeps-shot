const { ScreepsAPI } = require('screeps-api')
const { send } = require('micro')
const fs = require('fs')
const util = require('util')
// const crypto = require('crypto')
const Canvas = require('canvas')
const axios = require('axios')
const Stream = require('./stream')
const randomColor = require('randomcolor')
const seedrandom = require('seedrandom')
const imgCache = {}
const apiCache = {}
const roomCache = {}
const userCache = {}

const colors = {
  2: '#FF9600', // invader
  3: '#FF9600', // source keeper
  w: '#000000', // wall
  r: '#3C3C3C', // road
  pb: '#FFFFFF', // powerbank
  p: '#00C8FF', // portal
  s: '#FFF246', // source
  m: '#AAAAAA', // mineral
  c: '#505050', // controller
  k: '#640000' // keeperLair
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

function getColor (identifier) {
  if (!colors[identifier]) {
    Math.seedrandom(identifier)
    const seed = Math.random().toString()
    colors[identifier] = randomColor({
      luminosity: 'bright',
      seed
    })
  }
  return colors[identifier]
}

function getMapImageUrl (config, room) {
  return `${config.protocol}://${config.hostname}:${config.port}/assets/map/${room}.png`
}

async function getMapImage (config, room) {
  let cache = imgCache[config.hostname] = imgCache[config.hostname] || {}
  if (cache[room]) return cache[room]
  const url = await getMapImageUrl(config, room)
  const data = await axios.get(url, { responseType: 'arraybuffer' })
  // const img = new Canvas.Image()
  // img.src = data.data
  cache[room] = data.data // img
  return data.data // img
}

module.exports = async (req, res) => {
  if (req.url.match('favico')) return ''
  if (req.url.match('randomColor')) {
    res.setHeader('content-type', 'application/javascript')
    return await readFile('./node_modules/randomcolor/randomColor.js', 'utf8')
  }
  if (req.url.match('seedrandom')) {
    res.setHeader('content-type', 'application/javascript')
    return await readFile('./node_modules/seedrandom/seedrandom.js', 'utf8')
  }
  let [, protocol, hostname, port, mode = 'image', roomName] = req.url.split('/')
  if (!protocol || !hostname || !port) {
    let list = Object.keys(apiCache)
      .map(k => apiCache[k])
      .map(({ opts: { protocol, hostname, port }}) => `${hostname} <a href="/${protocol}/${hostname}/${port}">Static</a> <a href="/${protocol}/${hostname}/${port}/viewer">Live</a>`)
      .join('\n')
    res.setHeader('content-type', 'text/html')
    return `
    URL must be in the form of /protocol/hostname/port. 
    ex: <a href="/http/botarena.screepspl.us/21025">/http/botarena.screepspl.us/21025</a>
    you can view a live-updating view by appending /viewer
    ex: <a href="/http/botarena.screepspl.us/21025/viewer">/http/botarena.screepspl.us/21025/viewer</a>
    Currently Active Servers:
    ${list}
    `.replace(/\n/g, '<br>')
  }

  if (mode === 'stream') {
    let s = new Stream(req, res)
    let handler = async ({ id, data }) => {
      await captureMap({ protocol, hostname, port })
      // const DIM = 50 // 9 * 50
      // const canvas = new Canvas(DIM, DIM)
      // const ctx = canvas.getContext('2d')
      // let img = await getMapImage({ protocol, hostname, port }, id)
      // ctx.drawImage(img, 0, 0, 50, 50)
      // await renderRoom(ctx, data)
      // let frame = await canvas.toBuffer()
      // frame = 'data:image/png;base64,' + frame.toString('base64')
      const { info } = roomCache[hostname][id] || {}
      s.send('frame', { room: id, data, info })
    }
    // await handler()
    await captureMap({ protocol, hostname, port })
    let cnt = 0
    let api = apiCache[hostname]
    api.socket.on('roomMap2', handler)
    res.on('end', () => {
      api.socket.off('roomMap2', handler)
    })
    setTimeout(() => {
      Object.keys(roomCache[hostname]).forEach(id => {
        const { data } = roomCache[hostname][id]
        handler({ id, data })
      })
    },100)
    return undefined
    // return new Promise(() => {})
  }
  if (mode === 'viewer') {
    res.setHeader('content-type', 'text/html')
    return await readFile('./static/viewer.html', 'utf8')
  }
  if (mode === 'roomImage') {
    let img = await getMapImage({ protocol, hostname, port }, roomName)
    res.setHeader('content-type', 'image/png')
    return img
  }
  if (mode === 'badge') {
    let img = await getBadgeImage({ protocol, hostname, port }, roomName)
    res.setHeader('content-type', 'application/xml+svg')
    return img
  }
  if (mode === 'image') {
    // await api.raw.
    if (req.headers['if-none-match'] === etag()) {
      return send(res, 304, 'Not Modified')
    }
    res.setHeader('content-type', 'image/png')
    // res.setHeader('cache-control','max-age=10')
    // res.setHeader('etag', etag())
    return captureMap({ protocol, hostname, port })
  }
}

function etag () {
  return Math.round(Date.now() / 5000).toString(36).slice(2)
}

async function captureMap (opts) {
  // for (let y = 0; y < 11; y++) {
  //   for (let x = 0; x < 11; x++) {
  //     getMapImage(opts, `W${x}N${y}`)
  //   }
  // }
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
    userCache[opts.hostname] = {}
    try {
      const { rooms, users } = await updateMap(opts, api)


      rooms.forEach(info => {
        api.socket.send(`subscribe roomMap2:${info.id}`)
      })
    } catch(e) {
      console.error(e)
    }
    api.socket.on(`roomMap2`, ({ id, data }) => {
      roomCache[opts.hostname][id].data = data
    })
    console.log('Waiting for events...')
  }
}

async function updateMap (opts, api) {
  const { rooms, users } = await getMapRooms(api)
  const baseURL = `${opts.protocol}://${opts.hostname}:${opts.port}`
  for (let uid in users) {
    const user = users[uid]
    const oldUser = userCache[opts.hostname][uid]
    userCache[opts.hostname][uid] = user
    if (oldUser && oldUser.badgeSvg) {
      user.badgeSvg = oldUser.badgeSvg
    } else {
      axios.get(`${baseURL}/api/user/badge-svg?username=${user.username}`).then(({data: svg}) => {
        user.badgeSvg = svg
      }).catch(e => console.error(e))      
    }
  }
  rooms.forEach(info => {
    if (info.own) {
      info.own.user = users[info.own.user] || {}
    }
    roomCache[opts.hostname][info.id] = { info, data: {} }
  })
  return { rooms, users }
}

async function renderMap (rooms) {
  const DIM = 11 * 50 // 9 * 50
  const canvas = new Canvas(DIM, DIM)
  const ctx = canvas.getContext('2d')
  for (let k in rooms) {
    await renderRoom(ctx, k, rooms[k])
  }
  return canvas
}

async function renderRoom (ctx, data) {
  for (let k in data) {
    let arr = data[k]
    ctx.fillStyle = getColor(k)
    arr.forEach(([x, y]) => {
      ctx.beginPath()
      ctx.rect(x, y, 1, 1)
      ctx.fill()
    })
  }
}

// captureMap()

function XYToRoom (x, y) {
  let dx = 'E'
  let dy = 'S'
  if (x < 0) {
    x = -x - 1
    dx = 'W'
  }
  if (y < 0) {
    y = -y - 1
    dy = 'N'
  }
  return `${dx}${x}${dy}${y}`
}

function XYFromRoom (room) {
  console.log('XYFromRoom', room)
  let [, dx, x, dy, y] = room.match(/^([WE])(\d+)([NS])(\d+)$/)
  x = parseInt(x)
  y = parseInt(y)
  if (dx === 'W') x = -x - 1
  if (dy === 'N') y = -y - 1
  return { x, y }
}

async function getMapRooms (api, shard = 'shard0') {
  let visited = {}
  console.log('Scanning sectors')
  const sectors = await scanSectors()
  let roomsToScan = []
  console.log('Sectors found:', sectors)
  for (let room of sectors) {
    let { x, y } = XYFromRoom(room)
    for (let xx = 0; xx < 12; xx++) {
      for (let yy = 0; yy < 12; yy++) {
        let room = XYToRoom(x + xx - 6, y + yy - 6)
        roomsToScan.push(room)
      }
    }
  }
  const { rooms, users } = await scan(roomsToScan)
  console.log(`GetMapRooms found ${rooms.length} rooms`)
  return { rooms, users }

  async function scanSectors () {
    let rooms = []
    for (let yo = -10; yo <= 10; yo++) {
      for (let xo = -10; xo <= 10; xo++) {
        let room = XYToRoom((xo * 10) + 5, (yo * 10) + 5)
        rooms.push(room)
      }
    }
    let result = await scan(rooms)
    return result.rooms.map(r => r.id)
  }

  async function scan (rooms = []) {
    // console.log('Scanning', rooms)
    // rooms = rooms.filter(r => !visited[r])
    if (!rooms.length) return []
    let result = await api.raw.game.mapStats(rooms, shard, 'owner0')
    let ret = []
    // console.log(result)
    for (let k in result.stats) {
      let { status, own } = result.stats[k]
      result.stats[k].id = k
      if (status === 'normal') {
        visited[k] = true
        ret.push(result.stats[k])
      }
    }
    // console.log('Found', ret)
    return { rooms: ret, users: result.users }
  }
}
