class Stream {
  constructor (req, res) {
    this.res = res
    this.res.setHeader('Content-Type', 'text/event-stream')
    this.res.setHeader('Cache-Control', 'no-cache')
    this.res.setHeader('Connection', 'keep-alive')
    req.socket.setNoDelay(true)
    this.res.write(':ok\n\n')
  }
  send (event, data) {
    if (typeof data !== 'string') data = JSON.stringify(data)
    this.res.write(`event: ${event}\n`)
    data.split('\n').forEach(data => this.res.write(`data: ${data}\n`))
    this.res.write('\n')
  }
}

module.exports = Stream