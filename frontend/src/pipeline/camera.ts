/**
 * Camera access. `ideal` (not `exact`) constraints: a camera that can't do exactly 640×480
 * still opens at its closest mode instead of failing with OverconstrainedError.
 */
export const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  facingMode: "user",
};

export type CameraErrorKind =
  "denied" | "not_found" | "in_use" | "overconstrained" | "insecure" | "unknown";

const MESSAGES: Record<Exclude<CameraErrorKind, "unknown">, string> = {
  denied:
    "Camera access is blocked. Click the camera icon in the address bar and choose Allow " +
    "(on macOS, also check System Settings → Privacy & Security → Camera), then press Start again.",
  not_found: "No camera was found. Connect a camera and press Start again.",
  in_use:
    "The camera could not be started. It may be in use by another app (Zoom, Teams, " +
    "another tab). Close it and press Start again.",
  overconstrained: "This camera does not offer a usable video mode.",
  insecure: "The camera is only available on a secure (HTTPS) page.",
};

export class CameraError extends Error {
  readonly kind: CameraErrorKind;

  constructor(kind: CameraErrorKind, message: string) {
    super(message);
    this.name = "CameraError";
    this.kind = kind;
  }
}

/** Translates a getUserMedia rejection into a message a person can act on. */
export function toCameraError(error: unknown): CameraError {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return new CameraError("denied", MESSAGES.denied);
    case "NotFoundError":
    case "DevicesNotFoundError":
      return new CameraError("not_found", MESSAGES.not_found);
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return new CameraError("in_use", MESSAGES.in_use);
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return new CameraError("overconstrained", MESSAGES.overconstrained);
    case "SecurityError":
      return new CameraError("insecure", MESSAGES.insecure);
    default: {
      const detail = error instanceof Error ? error.message : String(error);
      return new CameraError("unknown", `Could not open the camera: ${detail}`);
    }
  }
}

export async function openCamera(): Promise<MediaStream> {
  // The DOM types say mediaDevices always exists, but browsers leave it undefined outside a
  // secure context (e.g. plain http on a LAN IP).
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  if (!window.isSecureContext || devices === undefined) {
    throw new CameraError("insecure", MESSAGES.insecure);
  }
  try {
    return await devices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false });
  } catch (error) {
    throw toCameraError(error);
  }
}
