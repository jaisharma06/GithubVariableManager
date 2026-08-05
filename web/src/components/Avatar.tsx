import { useState } from 'react'

interface AvatarProps {
  login: string
  avatarUrl?: string
  size?: number
}

export function Avatar({ login, avatarUrl, size = 24 }: AvatarProps) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)
  const initial = login.trim().charAt(0).toUpperCase() || '?'
  const showImage = Boolean(avatarUrl) && !errored

  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand font-display text-xs font-bold text-on-brand"
      style={{ width: size, height: size }}
    >
      {!(showImage && loaded) ? <span aria-hidden={showImage}>{initial}</span> : null}
      {showImage ? (
        <img
          src={avatarUrl}
          alt={`${login}'s avatar`}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          className={`absolute inset-0 h-full w-full object-cover ${loaded ? '' : 'hidden'}`}
        />
      ) : null}
    </span>
  )
}
