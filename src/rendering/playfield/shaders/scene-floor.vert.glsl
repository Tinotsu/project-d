varying vec3 scenePosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  scenePosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
