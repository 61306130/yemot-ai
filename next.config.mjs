/** @type {import('next').NextConfig} */
const nextConfig = {
  // ffmpeg (להאצת הקול של גוגל) - קובץ הרצה שצריך להיכלל בפונקציות של השרת
  serverExternalPackages: ['ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/**/*': ['./node_modules/ffmpeg-static/ffmpeg'],
  },
};
export default nextConfig;
