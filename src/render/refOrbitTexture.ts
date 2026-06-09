/**
 * Wraps the high-precision reference orbit (interleaved Re,Im float32 pairs,
 * texel n = Z_n) into an RG32F 2-D texture that the Tier C shader reads via
 * `texelFetch(uRefOrbit, ivec2(m % width, m / width), 0)`.
 *
 * The 1-D iteration array is wrapped row-major because a single texture row is
 * capped at MAX_TEXTURE_SIZE. Width 4096 is supported by ~all WebGL2 devices;
 * it is clamped down if the GPU reports a smaller max.
 */

const TARGET_WIDTH = 4096

export function orbitTextureSize(
  texelCount: number,
  maxTexSize: number,
): { width: number; height: number } {
  const width = Math.min(TARGET_WIDTH, maxTexSize)
  const height = Math.max(1, Math.ceil(texelCount / width))
  return { width, height }
}

export class RefOrbitTexture {
  private gl: WebGL2RenderingContext
  private tex: WebGLTexture
  private maxTexSize: number
  width = 1
  height = 1
  /** Last valid reference index (rebase wraps here). */
  maxRefIter = 0

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    const tex = gl.createTexture()
    if (!tex) throw new Error("Failed to create reference-orbit texture")
    this.tex = tex
    this.maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  }

  /**
   * Upload an orbit. `texelCount` = number of valid Z_n entries
   * (maxRefIter + 1); `orbit` holds at least `texelCount*2` floats.
   */
  update(orbit: Float32Array, maxRefIter: number): void {
    const { gl } = this
    const texelCount = maxRefIter + 1
    const { width, height } = orbitTextureSize(texelCount, this.maxTexSize)
    this.width = width
    this.height = height
    this.maxRefIter = Math.min(maxRefIter, width * height - 1)

    // Pad to a full width×height grid (RG = 2 floats per texel).
    const needed = width * height * 2
    const data = orbit.length >= needed ? orbit : new Float32Array(needed)
    if (data !== orbit) data.set(orbit.subarray(0, Math.min(orbit.length, needed)))

    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, width, height, 0, gl.RG, gl.FLOAT, data)
  }

  bind(unit: number): void {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
  }

  dispose(): void {
    this.gl.deleteTexture(this.tex)
  }
}
