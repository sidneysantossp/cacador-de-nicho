import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader:false,
  output:'standalone',
  serverExternalPackages:['@aws-sdk/client-s3','@aws-sdk/s3-request-presigner'],
  async headers(){
    return [{
      source:'/(.*)',
      headers:[
        {key:'X-Content-Type-Options',value:'nosniff'},
        {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
        {key:'X-Frame-Options',value:'DENY'}
      ]
    }];
  }
};

export default config;
