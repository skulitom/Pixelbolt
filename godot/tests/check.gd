# Runs in the throwaway project. Compare the actual Godot resources, including
# drawn pixels, rather than predicting any of Pixelbolt's export rules.
extends SceneTree

var failures := []
var totals := {"resources": 0, "animations": 0, "frames": 0, "tiles": 0}

func require(value: bool, message: String) -> void:
	if not value:
		failures.append(message)

func pixels(image: Image) -> String:
	if image == null:
		return "NO IMAGE"
	image.convert(Image.FORMAT_RGBA8)
	var data := image.get_data()
	for i in range(0, data.size(), 4):
		if data[i + 3] == 0:
			data[i] = 0
			data[i + 1] = 0
			data[i + 2] = 0
	var hash := HashingContext.new()
	hash.start(HashingContext.HASH_SHA256)
	hash.update(data)
	return str(image.get_size()) + ":" + hash.finish().hex_encode()

func sheet_image(texture: Texture2D) -> Image:
	if texture is CanvasTexture:
		return texture.diffuse_texture.get_image()
	return texture.get_image()

func drawn(texture: AtlasTexture) -> String:
	var image := sheet_image(texture.atlas)
	if image == null:
		return "NO SHEET"
	image.convert(Image.FORMAT_RGBA8)
	var canvas := Image.create(texture.get_width(), texture.get_height(), false, Image.FORMAT_RGBA8)
	canvas.blit_rect(image, Rect2i(texture.region), Vector2i(texture.margin.position))
	return pixels(canvas)

func filter_check(texture: Texture2D, inherit: bool, context: String) -> void:
	if inherit:
		require(texture is ImageTexture, context + ": Inherit needs a plain ImageTexture")
	else:
		require(texture is CanvasTexture, context + ": Nearest needs CanvasTexture")
		if texture is CanvasTexture:
			require(texture.texture_filter == CanvasItem.TEXTURE_FILTER_NEAREST, context + ": nearest filter")

func self_contained(value: Variant, context: String) -> void:
	if value is Resource:
		var location: String = value.resource_path
		require(location.is_empty() or location.begins_with("res://.godot/imported/") or location.begins_with(context),
			"external resource: " + location)
		require(not location.contains("/pixelbolt/"), "temporary reference: " + location)
		for property in value.get_property_list():
			if property["usage"] & PROPERTY_USAGE_STORAGE and property["name"] != "script":
				self_contained(value.get(property["name"]), context)
	elif value is Array or value is Dictionary:
		for item in (value.values() if value is Dictionary else value):
			self_contained(item, context)

# Storage properties include TileSet terrain sets, TileSetAtlasSource tile coordinates,
# alternatives, animation frame count/durations and every stored TileData property
# (terrain/peering/probability/collision). Ignore only resource identity and addon metadata.
func canonical(value: Variant) -> Variant:
	if value is Texture2D:
		return {"pixels": pixels(sheet_image(value))}
	if value is Resource:
		var result := {"class": value.get_class()}
		for property in value.get_property_list():
			var key: String = property["name"]
			if property["usage"] & PROPERTY_USAGE_STORAGE and key not in ["resource_path", "resource_scene_unique_id", "script"] and not key.begins_with("metadata/"):
				result[key] = canonical(value.get(key))
		return result
	if value is Array:
		var result := []
		for item in value:
			result.append(canonical(item))
		return result
	if value is Dictionary:
		var result := {}
		for key in value:
			result[key] = canonical(value[key])
		return result
	return value

func compare_frames(actual: SpriteFrames, expected: SpriteFrames, entry: Dictionary) -> void:
	var names := actual.get_animation_names()
	require(names == expected.get_animation_names(), entry["key"] + ": animation names")
	for animation in expected.get_animation_names():
		var context: String = entry["key"] + "/" + animation
		require(actual.has_animation(animation), context + ": missing animation")
		if not actual.has_animation(animation):
			continue
		totals["animations"] += 1
		require(actual.get_animation_speed(animation) == expected.get_animation_speed(animation), context + ": speed")
		require(actual.get_animation_loop(animation) == expected.get_animation_loop(animation), context + ": loop")
		require(actual.get_frame_count(animation) == expected.get_frame_count(animation), context + ": frame count")
		for i in mini(actual.get_frame_count(animation), expected.get_frame_count(animation)):
			totals["frames"] += 1
			var frame_context := context + "/" + str(i)
			var a = actual.get_frame_texture(animation, i)
			var b = expected.get_frame_texture(animation, i)
			require(a is AtlasTexture and b is AtlasTexture, frame_context + ": AtlasTexture")
			if not a is AtlasTexture or not b is AtlasTexture:
				continue
			require(actual.get_frame_duration(animation, i) == expected.get_frame_duration(animation, i), frame_context + ": duration")
			for key in ["region", "margin", "filter_clip"]:
				require(a.get(key) == b.get(key), frame_context + ": " + key)
			require(a.get_size() == b.get_size(), frame_context + ": size")
			require(drawn(a) == drawn(b), frame_context + ": drawn pixels")
			filter_check(a.atlas, entry.get("inherit", false), frame_context)

func _initialize() -> void:
	var plan = JSON.parse_string(FileAccess.get_file_as_string("res://cases.json"))
	for entry in plan["cases"]:
		var actual = load(entry["source"])
		var expected = load(entry["expected"])
		totals["resources"] += 1
		require(actual is Resource and expected is Resource, entry["key"] + ": resources load")
		if actual == null or expected == null:
			continue
		require(actual.get_meta("pixelbolt", {}) == {"version": entry.get("version", plan["version"]), "source": entry["source"]}, entry["key"] + ": metadata")
		self_contained(actual, actual.resource_path)
		if actual is SpriteFrames and expected is SpriteFrames:
			compare_frames(actual, expected, entry)
		elif actual is TileSet and expected is TileSet:
			require(canonical(actual) == canonical(expected), entry["key"] + ": TileSet properties/pixels")
			for i in actual.get_source_count():
				var atlas = actual.get_source(actual.get_source_id(i))
				totals["tiles"] += atlas.get_tiles_count()
				filter_check(atlas.texture, entry.get("inherit", false), entry["key"])
		else:
			require(false, entry["key"] + ": wrong resource type")
	var temporary := DirAccess.open("res://.godot/pixelbolt")
	require(temporary == null or (temporary.get_directories().is_empty() and temporary.get_files().is_empty()), "temporary render leftovers")
	print("PIXELBOLT " + JSON.stringify({"failures": failures, "totals": totals}))
	quit(0 if failures.is_empty() else 1)
