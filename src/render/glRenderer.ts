import type { RenderParams } from "./types"
import fragSource from "./mandelbrot.frag?raw"
import vertSource from "./mandelbrot.vert?raw"

type Uniforms = {
  uResolution: WebGLUniformLocation
  uCenter: WebGLUniformLocation
  uSpanX: WebGLUniformLocation
  uMaxIter: WebGLUniformLocation
  uHue: WebGLUniformLocation
  uSat: WebGLUniformLocation
  uVal: WebGLUniformLocation
  uScale: WebGLUniformLocation
  uOffset: WebGLUniformLocation
  uSmooth: WebGLUniformLocation
  uMode: WebGLUniformLocation
}

export class GLRenderer {
  private gl: WebGL2RenderingContext
  private vao: WebGLVertexArrayObject
  private program: WebGLProgram
  private uniforms: Uniforms

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false })
    if (!gl) throw new Error("WebGL2 not supported")
    this.gl = gl

    const vs = compile(gl, gl.VERTEX_SHADER, vertSource)
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSource)
    this.program = link(gl, vs, fs)

    this.uniforms = {
      uResolution: getUniform(gl, this.program, "uResolution"),
      uCenter: getUniform(gl, this.program, "uCenter"),
      uSpanX: getUniform(gl, this.program, "uSpanX"),
      uMaxIter: getUniform(gl, this.program, "uMaxIter"),
      uHue: getUniform(gl, this.program, "uHue"),
      uSat: getUniform(gl, this.program, "uSat"),
      uVal: getUniform(gl, this.program, "uVal"),
      uScale: getUniform(gl, this.program, "uScale"),
      uOffset: getUniform(gl, this.program, "uOffset"),
      uSmooth: getUniform(gl, this.program, "uSmooth"),
      uMode: getUniform(gl, this.program, "uMode"),
    }

    const vao = gl.createVertexArray()
    if (!vao) throw new Error("Failed to create VAO")
    this.vao = vao
  }

  resize(width: number, height: number): void {
    const { gl } = this
    if (gl.canvas.width !== width) gl.canvas.width = width
    if (gl.canvas.height !== height) gl.canvas.height = height
    gl.viewport(0, 0, width, height)
  }

  render(params: RenderParams): void {
    const { gl, vao, uniforms } = this
    gl.useProgram(this.program)
    gl.bindVertexArray(vao)
    gl.uniform2f(uniforms.uResolution, params.width, params.height)
    gl.uniform2f(uniforms.uCenter, params.cx, params.cy)
    gl.uniform1f(uniforms.uSpanX, params.spanX)
    gl.uniform1i(uniforms.uMaxIter, params.iterations)
    gl.uniform1f(uniforms.uHue, params.palette.hue)
    gl.uniform1f(uniforms.uSat, params.palette.sat)
    gl.uniform1f(uniforms.uVal, params.palette.val)
    gl.uniform1f(uniforms.uScale, params.palette.scale)
    gl.uniform1f(uniforms.uOffset, params.palette.offset)
    gl.uniform1i(uniforms.uSmooth, params.palette.smooth ? 1 : 0)
    gl.uniform1i(uniforms.uMode, params.palette.mode === "iq" ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose(): void {
    const { gl } = this
    gl.deleteProgram(this.program)
    gl.deleteVertexArray(this.vao)
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error("Failed to create shader")
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "(no log)"
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed:\n${log}`)
  }
  return shader
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error("Failed to create program")
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.detachShader(program, vs)
  gl.detachShader(program, fs)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "(no log)"
    gl.deleteProgram(program)
    throw new Error(`Program link failed:\n${log}`)
  }
  return program
}

function getUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const loc = gl.getUniformLocation(program, name)
  if (!loc) throw new Error(`Uniform '${name}' not found (probably optimized out)`)
  return loc
}
