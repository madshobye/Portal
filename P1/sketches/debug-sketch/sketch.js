let canvas;
let sound

let apiKeyEncryptedGpt22 ="U2FsdGVkX18009lW4clpttBLCMAsuBYgQZRiEWcsqhqoPwnEL0ka5JbJOwVlkKco88ToU9L42cPy5j++dtaCm1KgO8vV/dMe6bpMDrWs0IXjElBPml1tj8jUIj+oeLXzZuMTtYgGQfyPW+PxU+VtINE4kAvccUD2vXYgym3SYYUm0rD2RNguEmSzU+660DXYPix5qEnRFAHRUSnDdISYulwc8WNBF3gUQl1VEpUg7Ku9G2gCG6dTZ/JoJ6ZELr8W"

let apiKey = "";

let gpt;

async function setup() {

  canvas = createCanvas(windowWidth, windowHeight);
 
  textSize(20);
  fill(255);
    await loadScript("portal/GptClient.js");



  apiKey = storedDecrypt({ apiKeyEncryptedGpt22 });

  const schema = [

  {

    name: "color_response",

    description: "Return the color mentioned in the text.",

    parameters: {

      type: "object",

      properties: {

        color: { type: "string" }

      },

      required: ["color"]

    }

  }

];



gpt = new GptClient({

  apiKey,

  model: "gpt-4o-mini",

  instructions: "Extract the color mentioned in the user's sentence.",

  functionSchemas: schema,

  functionName: "color_response"

});



const res = await gpt.ask("I like the color blue.");

console.log(res); // { color: "blue" } or { error: "..." }
print("hest")


}

function draw() {
  background(0);
  
}




