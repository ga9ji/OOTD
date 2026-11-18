// Grazing stage light across the folds of a pleated satin backdrop.
uniform float clock;
uniform float aspect;
varying vec2 coord;
void main() {
  vec2 p = vec2((coord.x - .72) * aspect, coord.y - .47);
  float time = clock * .15;
  float arc = atan(p.y + .14, p.x + .32);
  float weave = length(vec2(p.x + .32, p.y + .14)) + .16 * sin(arc * 2. + time)
              + .075 * sin(p.x * 3.7 - p.y * 4. + time * .6);
  float fold = weave * 15.5 + 1.3 * sin(weave * 6. - time);
  float ridge = .5 + .5 * cos(fold);
  float thread = .5 + .5 * sin(weave * 170. + sin(arc * 3.));
  vec3 silk = mix(vec3(.115,.018,.047), vec3(.93,.18,.065), pow(ridge,.76));
  silk += vec3(.95,.60,.32) * pow(ridge, 12.) * (.39 + .38 * thread);
  silk += vec3(.48,.45,.40) * pow(.5 + .5 * cos(fold + .45), 45.);
  float spotlight = exp(-2.3 * dot(p - vec2(.12,.09), p - vec2(.12,.09)));
  float ink = smoothstep(.05,.79,coord.x) * .83 + .17;
  gl_FragColor = vec4(mix(vec3(.049,.047,.060), silk, ink * (.48 + .52 * spotlight)), 1.);
}
