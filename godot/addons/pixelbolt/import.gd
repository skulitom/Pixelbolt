# Converts only the CLI's resources, never its timing/layout rules. Each attempt stages
# under .godot; a failed attempt cannot replace a previously usable resource.
@tool
extends EditorImportPlugin

const Settings = preload("settings.gd")
const CLI = preload("cli.gd")

func _get_recognized_extensions() -> PackedStringArray:
	return PackedStringArray(["pixelbolt", "pixel.json"])

func _get_save_extension() -> String:
	return "res"

func _get_import_order() -> int:
	return 0

func _get_preset_count() -> int:
	return 0

func _get_import_options(_path: String, _preset_index: int) -> Array:
	return [{"name": "texture_filter", "default_value": 0,
		"property_hint": PROPERTY_HINT_ENUM, "hint_string": "Nearest,Inherit"}]

func _get_option_visibility(_path: String, _option_name: StringName, _options: Dictionary) -> bool:
	return true

func _can_import_threaded() -> bool:
	return false

func _import(source_file: String, save_path: String, options: Dictionary,
		_platform_variants: Array[String], _gen_files: Array[String]) -> Error:
	var base := ProjectSettings.globalize_path("res://.godot/pixelbolt")
	var folder := base.path_join("%d-%d" % [OS.get_process_id(), Time.get_ticks_usec()])
	var target := ProjectSettings.globalize_path(save_path + ".res").simplify_path()
	if not target.begins_with(ProjectSettings.globalize_path("res://.godot/")):
		return _failure(source_file, target, "Import destination must be inside res://.godot/.")
	if DirAccess.dir_exists_absolute(folder) or DirAccess.make_dir_recursive_absolute(folder) != OK:
		return _failure(source_file, target, "Cannot create a fresh .godot/pixelbolt folder; check project permissions.")
	var result := _build(source_file, folder, int(options.get("texture_filter", 0)))
	if not result.has("error"):
		var staged := folder.path_join("import.res")
		var resource: Resource = result["resource"]
		resource.set_meta("pixelbolt", {"version": result["version"], "source": source_file})
		if ResourceSaver.save(resource, staged, ResourceSaver.FLAG_COMPRESS) != OK:
			result = {"error": "Cannot save the import; check free space and project permissions."}
		elif DirAccess.rename_absolute(staged, target) != OK:
			result = {"error": "Cannot replace the import; check project permissions and reimport."}
	var cleaned := _remove_tree(folder)
	if result.has("error"):
		return _failure(source_file, target, str(result["error"]) + ("" if cleaned else " Temporary folder could not be removed: " + folder))
	if not cleaned:
		return _failure(source_file, target, "Temporary folder could not be removed: " + folder + "; check permissions.")
	print("Pixelbolt %s: imported %s (%s)" % [result["version"], source_file, result["summary"]])
	return OK

func _failure(source: String, target: String, message: String) -> Error:
	# printerr: one red, actionable line in the Output, without push_error's backtrace lines.
	var retained := FileAccess.file_exists(target)
	printerr("Pixelbolt: %s: %s%s" % [source, message.replace("\n", " ").replace("\r", " "),
		" Previous import kept." if retained else " No previous import."])
	return OK if retained else ERR_CANT_CREATE

func _remove_tree(folder: String) -> bool:
	var directory := DirAccess.open(folder)
	if directory == null:
		return false
	var success := true
	for file in directory.get_files():
		success = (directory.remove(file) == OK) and success
	for subdir in directory.get_directories():
		if directory.is_link(subdir):
			success = (directory.remove(subdir) == OK) and success
		else:
			success = _remove_tree(folder.path_join(subdir)) and success
	return (DirAccess.remove_absolute(folder) == OK) and success

func _sheet(image: Image, filter_mode: int) -> Texture2D:
	var texture := ImageTexture.create_from_image(image)
	if filter_mode != 0:
		return texture
	var canvas := CanvasTexture.new()
	canvas.diffuse_texture = texture
	canvas.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	return canvas

func _build(source: String, folder: String, filter_mode: int) -> Dictionary:
	var command := CLI.resolve_cli()
	if command.has("error"):
		return command
	var deadline: int = Time.get_ticks_msec() + maxi(1, int(Settings.read("import/timeout_seconds"))) * 1000
	var input := ProjectSettings.globalize_path(source)
	var parser := JSON.new()
	# Invalid JSON still goes through the CLI, whose diagnostic is the useful one.
	if parser.parse(FileAccess.get_file_as_string(source)) == OK:
		if parser.data is Dictionary and parser.data.get("format") is String:
			var compiled := folder.path_join("recipe.json")
			var compilation := CLI.run(command, PackedStringArray(["compile", input, "--out", compiled]), deadline)
			if compilation.has("error"):
				return compilation
			input = compiled
	var out := folder.path_join("out")
	var reply := CLI.run(command, PackedStringArray(["render", input, "--out", out]), deadline)
	if reply.has("error"):
		return reply
	var tiles: bool = _get_resource_type() == "TileSet"
	var resource_file := ""
	for file in reply.get("files", []):
		if file is String and file.ends_with(".tileset.tres" if tiles else ".tres"):
			if tiles or not file.ends_with(".tileset.tres"):
				resource_file = file
	if resource_file.is_empty():
		return {"error": "No TileSet was exported; use an autotile recipe and reimport." if tiles else
			"No SpriteFrames was exported; for a tile set pick Import As → Pixelbolt TileSet in the Import dock."}
	var sheet_file = reply.get("sheet", "")
	if not sheet_file is String or sheet_file.is_empty():
		return {"error": "CLI output has no sheet; check the Pixelbolt installation and reimport."}
	# A reply names files relative to its new output folder. Never load arbitrary reply paths.
	for file in [resource_file, sheet_file]:
		if file.is_absolute_path() or file.contains("/") or file.contains("\\"):
			return {"error": "Unexpected output filename; check the Pixelbolt CLI and reimport."}
	var sheet_path := out.path_join(sheet_file)
	var tres_path := out.path_join(resource_file)
	if not FileAccess.file_exists(sheet_path) or not FileAccess.file_exists(tres_path):
		return {"error": "Missing sheet or .tres in CLI output; check the Pixelbolt installation and reimport."}
	var image := Image.new()
	if image.load(sheet_path) != OK:
		return {"error": "Cannot read the CLI's sheet; check the Pixelbolt installation and reimport."}
	var temporary_sheet := folder.path_join("sheet.res")
	if ResourceSaver.save(_sheet(image, filter_mode), temporary_sheet) != OK:
		return {"error": "Cannot stage the sheet; check project permissions and free space."}
	var text := FileAccess.get_file_as_string(tres_path)
	var lines := text.split("\n")
	var replaced := 0
	for i in lines.size():
		if lines[i].begins_with('[ext_resource type="Texture2D" path=') and lines[i].ends_with(' id="1_sheet"]'):
			lines[i] = '[ext_resource type="Texture2D" path=' + JSON.stringify(temporary_sheet) + ' id="1_sheet"]'
			replaced += 1
	if replaced != 1:
		return {"error": "Unrecognized sheet reference in CLI .tres; use a supported Pixelbolt version."}
	var staged_tres := folder.path_join("loaded.tres")
	var handle := FileAccess.open(staged_tres, FileAccess.WRITE)
	if handle == null:
		return {"error": "Cannot stage the .tres; check project permissions and free space."}
	handle.store_string("\n".join(lines))
	handle.close()
	var loaded := ResourceLoader.load(staged_tres, "", ResourceLoader.CACHE_MODE_IGNORE)
	var fresh := _sheet(image, filter_mode)
	var result: Resource
	var summary := ""
	if not tiles and loaded is SpriteFrames:
		var animations: Array = loaded.get("animations")
		var count := 0
		for animation in animations:
			for frame in animation["frames"]:
				var old = frame["texture"]
				if not old is AtlasTexture:
					return {"error": "Unexpected frame texture in CLI .tres; use a supported Pixelbolt version."}
				var atlas := AtlasTexture.new()
				atlas.atlas = fresh
				atlas.region = old.region
				atlas.margin = old.margin
				atlas.filter_clip = old.filter_clip
				frame["texture"] = atlas
				count += 1
		result = SpriteFrames.new()
		result.set("animations", animations)
		summary = "%d animations, %d frames" % [animations.size(), count]
	elif tiles and loaded is TileSet:
		# duplicate(true) keeps every TileData/animation/property from the CLI.
		result = loaded.duplicate(true)
		result.resource_path = ""
		for i in result.get_source_count():
			var atlas_source = result.get_source(result.get_source_id(i))
			if not atlas_source is TileSetAtlasSource:
				return {"error": "Unexpected TileSet source in CLI .tres; use a supported Pixelbolt version."}
			atlas_source.resource_path = ""
			atlas_source.texture = fresh
		summary = "%d tile sources" % result.get_source_count()
	else:
		return {"error": "Cannot load the CLI's .tres; check the Pixelbolt installation and reimport."}
	return {"resource": result, "version": command["version"], "summary": summary}
