#ifdef WARPED
varying vec2 logicalPosition;
#else
varying vec2 assetUv;
#endif

void main() {
#ifdef WARPED
  logicalPosition = position.xy;
#else
  assetUv = uv;
#endif

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
