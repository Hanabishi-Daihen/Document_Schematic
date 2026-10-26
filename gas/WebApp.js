function doGet() {
  // Index.html สร้างโดย npm run build (ฝัง CSS, ฟอนต์ และ JavaScript ไว้ครบในไฟล์เดียว)
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
