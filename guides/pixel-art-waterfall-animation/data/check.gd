extends SceneTree

func _init() -> void:
	var out := []
	for t in ["waterfall", "waterfall-12f", "waterfall-8f", "lavafall", "slimefall", "moonlit-waterfall"]:
		var d := DirAccess.open("res://" + t)
		for f in d.get_files():
			if not f.ends_with(".tres"):
				continue
			var sf := load("res://%s/%s" % [t, f]) as SpriteFrames
			if sf == null:
				out.append({"set": t, "file": f, "error": "did not load as SpriteFrames"})
				continue
			for a in sf.get_animation_names():
				if sf.get_frame_count(a) == 0:
					continue
				var n := sf.get_frame_count(a)
				var speed := sf.get_animation_speed(a)
				var ms := []
				var regions_ok := true
				var regions := []
				var first: Texture2D = sf.get_frame_texture(a, 0)
				for i in n:
					ms.append(snappedf(sf.get_frame_duration(a, i) / speed * 1000.0, 0.01))
					var tex := sf.get_frame_texture(a, i) as AtlasTexture
					if tex == null or tex.atlas == null:
						regions_ok = false
					else:
						regions.append([int(tex.region.position.x), int(tex.region.position.y), int(tex.region.size.x), int(tex.region.size.y)])
				var at := first as AtlasTexture
				out.append({"set": t, "file": f, "animation": String(a), "frames": n, "loop": sf.get_animation_loop(a),
					"speed_fps": speed, "frame_ms": ms.min(), "frame_ms_max": ms.max(),
					"frame_size": [int(at.region.size.x), int(at.region.size.y)],
					"sheet_size": [at.atlas.get_width(), at.atlas.get_height()], "atlas_textures": regions_ok,
					"regions": regions, "godot": Engine.get_version_info()["string"]})
	print("RESULT " + JSON.stringify(out))
	quit()
