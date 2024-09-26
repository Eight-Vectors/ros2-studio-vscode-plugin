window.addEventListener("message", (event) => {
  const message = event.data;
  console.log("Message received: ", message);

  switch (message.command) {
    case "map_data":
      mapdata = message.data;
      console.log("Map", mapdata);
      const canvasWidth = mapdata.width;
      const canvasHeight = mapdata.height;
      ctx.translate(canvasWidth / 2, canvasHeight / 2);
      const imageData = ctx.createImageData(mapdata.width, mapdata.height);
      const data = imageData.data;
      const pixels = mapdata.data;
      const maxval = 255;

      for (let i = 0; i < pixels.length; i++) {
        const intensity = Math.round((pixels[i] / maxval) * 255);
        data[i * 4] = intensity; // R
        data[i * 4 + 1] = intensity; // G
        data[i * 4 + 2] = intensity; // B
        data[i * 4 + 3] = 255; // A
      }
      ctx.putImageData(imageData, 0, 0);
      break;

    case "scan_data":
      const scanObj = message.data;
      const angle_min = scanObj.angle_min;
      const angle_max = scanObj.angle_max;
      const angle_increment = scanObj.angle_increment;
      const ranges = scanObj.ranges;
      console.log("MapData From Scan", mapdata);

      ranges.forEach((dp, idx) => {
        const angle = angle_min + idx * angle_increment;
        const px = 1 * ((dp * Math.cos(angle)) / mapdata.resolution);
        const py = -1 * ((dp * Math.sin(angle)) / mapdata.resolution);

        const width = 5;
        const height = 5;

        ctx.fillStyle = "green";
        ctx.fillRect(px, py, width, height);
      });
      break;
  }
});
