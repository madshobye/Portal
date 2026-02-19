//http://kallaspriit.github.io/HTML5-JavaScript-Gamepad-Controller-Library/
/*
// example interface names
FACE_1: 0
FACE_2: 0
FACE_3: 0
FACE_4: 0
LEFT_TOP_SHOULDER: 0
RIGHT_TOP_SHOULDER: 0
LEFT_BOTTOM_SHOULDER: 0.5
RIGHT_BOTTOM_SHOULDER: 0.5
SELECT_BACK: 0
START_FORWARD: 0
LEFT_STICK: 0
RIGHT_STICK: 0
DPAD_UP: 0.5
DPAD_DOWN: 0.5
DPAD_LEFT: 0.5
DPAD_RIGHT: 0.5
HOME: 0
LEFT_STICK_X: 0
LEFT_STICK_Y: -0.03529411554336548
RIGHT_STICK_X: 0
RIGHT_STICK_Y: 

*/
var gamePads;


async function setupGamepad() {
  await loadScript("libs/gamepadLib.js");
 
  // Attach it to the window so it can be inspected at the console.
  window.gamepad = new Gamepad();

  gamepad.bind(Gamepad.Event.CONNECTED, function(device) {
   //   console.log('aGamepad Connected', device);
    }

  );

  gamepad.bind(Gamepad.Event.DISCONNECTED, function(device) {
   // console.log('Gamepad Disconnected', device);

  });



  gamepad.bind(Gamepad.Event.TICK, function(gamepads) {
    gamePads = gamepads;
  });
  /*
		gamepad.bind(Gamepad.Event.BUTTON_DOWN, function(e) {
			console.log(e.gamepad.index + e.control + ' down');
		});

		gamepad.bind(Gamepad.Event.BUTTON_UP, function(e) {
			console.log(e.gamepad.index +  e.control + ' up');
		});

		gamepad.bind(Gamepad.Event.AXIS_CHANGED, function(e) {
			console.log(e.gamepad.index + e.axis + ' changed to ' + e.value);
		});
*/
  if (!gamepad.init()) {
    console.log('Your browser does not support gamepads, get the latest Google Chrome or Firefox.');
  }
}