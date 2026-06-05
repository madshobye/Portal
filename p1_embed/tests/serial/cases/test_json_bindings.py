from p1_serial import assert_equal, assert_true


def test_json_helpers_extract_build_and_emit(dev):
    code = """
function setup() {
  var main = jsonBuild(jsonPairFloat("temp", 22.01, 2), jsonPairInt("humidity", 46));
  var weather0 = jsonBuild(jsonPair("description", "clear sky"));
  var flags = jsonBuild(jsonPairBool("ok", 1));
  var weatherArray = jsonArray(weather0);
  var body = jsonBuild(jsonPair("name", "Roskilde"), jsonPairRaw("main", main), jsonPairRaw("weather", weatherArray), jsonPairRaw("flags", flags));
  var city = jsonGet(body, "name");
  var weather = jsonGet(body, "weather.0.description");
  var temp = jsonGetFloat(body, "main.temp");
  var humidity = jsonGetInt(body, "main.humidity");
  var ok = jsonGetBool(body, "flags.ok");
  println("city=" + city);
  println("weather=" + weather);
  println("humidity=" + humidity);
  println("hasTemp=" + jsonHas(body, "main.temp"));
  println("hasPressure=" + jsonHas(body, "main.pressure"));
  var out = jsonBuild(jsonPair("city", city), jsonPair("weather", weather), jsonPairFloat("temp", temp, 2), jsonPairInt("humidity", humidity), jsonPairBool("ok", ok));
  println("obj=" + out);
  emitJson("json.test", jsonPair("city", city), jsonPair("weather", weather), jsonPairFloat("temp", temp, 2), jsonPairInt("humidity", humidity), jsonPairBool("ok", ok));
}

function loop() {
  delay(100);
}
""".strip()
    dev.run_script(code, save=False, timeout=20.0)
    expected = [
        "city=Roskilde",
        "weather=clear sky",
        "humidity=46",
        "hasTemp=1",
        "hasPressure=0",
    ]
    for want in expected:
        msg = dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message")
        assert_equal(msg, want, f"print {want}")

    obj_msg = dev.wait_event("script.print", timeout=4.0).get("data", {}).get("message")
    assert_true(obj_msg.startswith("obj={"), "jsonBuild should produce an object")
    assert_true('"city":"Roskilde"' in obj_msg, "jsonBuild should contain string field")
    assert_true('"temp":22.01' in obj_msg, "jsonBuild should contain float field")

    event = dev.wait_event("json.test", timeout=4.0)
    data = event.get("data", {})
    assert_equal(data.get("city"), "Roskilde", "emitJson city")
    assert_equal(data.get("weather"), "clear sky", "emitJson weather")
    assert_equal(data.get("humidity"), 46, "emitJson humidity")
    assert_equal(data.get("ok"), True, "emitJson bool")
    assert_true(abs(float(data.get("temp")) - 22.01) < 0.01, "emitJson temp")
