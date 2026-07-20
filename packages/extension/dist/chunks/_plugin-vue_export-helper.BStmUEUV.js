import{E as d,F as p,S as c,_ as g,c as s,f as _}from"./vue.runtime.esm-bundler.DKZ3PwlV.js";var u=`<svg t="1775402599580" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5390" xmlns:xlink="http://www.w3.org/1999/xlink" width="100%" height="100%">
  <defs>
    <linearGradient id="opencode-logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea"/>
      <stop offset="100%" style="stop-color:#764ba2"/>
    </linearGradient>
  </defs>
  <g transform="rotate(180 512 512)">
  <path d="M512 981.33H85.34c-15.85 0-30.38-8.77-37.77-22.81a42.624 42.624 0 0 1 2.6-44.02L135 791.08C75.25 710.5 42.67 612.6 42.67 512 42.67 253.21 253.21 42.67 512 42.67S981.34 253.21 981.34 512 770.8 981.33 512 981.33zM166.44 896H512c211.73 0 384-172.27 384-384S723.73 128 512 128 128 300.27 128 512c0 91.29 32.83 179.9 92.46 249.46 12.58 14.69 13.73 36 2.77 51.94L166.44 896z" fill="url(#opencode-logo-gradient)" p-id="5391"/>
  <path d="M384 448m-64 0a64 64 0 1 0 128 0 64 64 0 1 0 -128 0Z" fill="url(#opencode-logo-gradient)" p-id="5392"/>
  <path d="M640 448m-64 0a64 64 0 1 0 128 0a64 64 0 1 0 -128 0Z" fill="url(#opencode-logo-gradient)" p-id="5393"/>
  </g>
</svg>
`,i=g({__name:"OpenCodeLogo",props:{size:{type:[String,Number],required:!1,default:"100%"}},setup(t,{expose:r}){r();const e=t,o=d(),n=`opencode-logo-gradient-${o}`,a={props:e,baseId:o,gradientId:n,rendered:s(()=>u.replace('id="opencode-logo-gradient"',`id="${n}"`).replace(/url\(#opencode-logo-gradient\)/g,`url(#${n})`)),sizeStyle:s(()=>{const l=typeof e.size=="number"?`${e.size}px`:e.size;return{width:l,height:l}})};return Object.defineProperty(a,"__isScriptSetup",{enumerable:!1,value:!0}),a}}),f=["innerHTML"];function v(t,r,e,o,n,a){return c(),_("span",{class:"opencode-logo",style:p([{display:"inline-block",lineHeight:0},o.sizeStyle]),innerHTML:o.rendered},null,12,f)}i.render=v;var m=i,y=(t,r)=>{const e=t.__vccOpts||t;for(const[o,n]of r)e[o]=n;return e};export{m as n,y as t};
