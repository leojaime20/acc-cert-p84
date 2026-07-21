import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoUploadError, readImageDimensions, validatePhotoFile } from './photoService';

function photoFile(type = 'image/jpeg', size = 100) {
  return new File([new Uint8Array(size)], 'photo.jpg', { type });
}

describe('validatePhotoFile', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('aceita %s', (type) => {
    expect(() => validatePhotoFile(photoFile(type))).not.toThrow();
  });

  it('explica como corrigir uma fotografia HEIC', () => {
    try {
      validatePhotoFile(photoFile('image/heic'));
      throw new Error('A validação deveria falhar.');
    } catch (error) {
      expect(error).toBeInstanceOf(PhotoUploadError);
      expect(error).toMatchObject({ stage: 'validation', code: 'unsupported-image-type' });
      expect((error as Error).message).toContain('HEIC/HEIF');
    }
  });

  it('rejects empty files', () => {
    expect(() => validatePhotoFile(photoFile('image/jpeg', 0))).toThrow('photo is empty');
  });

  it('rejeita originais maiores que 25 MB', () => {
    expect(() => validatePhotoFile(photoFile('image/jpeg', 25 * 1024 * 1024 + 1))).toThrow('25 MB');
  });
});

describe('readImageDimensions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('usa createImageBitmap quando o navegador suporta a imagem', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 1200, height: 900, close }),
    );

    await expect(readImageDimensions(photoFile())).resolves.toEqual({ width: 1200, height: 900 });
    expect(close).toHaveBeenCalledOnce();
  });

  it('usa Image como alternativa quando createImageBitmap falha', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('Safari decode error')));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    class TestImage {
      naturalWidth = 4032;
      naturalHeight = 3024;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', TestImage);

    await expect(readImageDimensions(photoFile())).resolves.toEqual({ width: 4032, height: 3024 });
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});
