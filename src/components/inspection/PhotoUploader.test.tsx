import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discardInspectionPhotoAttempt,
  PhotoUploadError,
  removeInspectionPhoto,
  uploadInspectionPhoto,
} from '../../services/photoService';
import type { InspectionPhoto } from '../../types/inspection';
import type { UserProfile } from '../../types/user';
import { PhotoUploader } from './PhotoUploader';

vi.mock('../../services/photoService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/photoService')>();
  return {
    ...actual,
    discardInspectionPhotoAttempt: vi.fn(),
    removeInspectionPhoto: vi.fn(),
    uploadInspectionPhoto: vi.fn(),
  };
});

const user = {
  uid: 'inspector-1',
  name: 'Inspector',
  email: 'inspector@example.com',
  role: 'inspector',
  active: true,
  projectIds: ['p84'],
  createdAt: null,
  updatedAt: null,
} as unknown as UserProfile;

function selectedPhoto(name: string) {
  return new File([new Uint8Array(100)], name, { type: 'image/jpeg' });
}

function completedPhoto(id: string, itemId: string | null, caption: string): InspectionPhoto {
  return {
    id,
    itemId,
    category: itemId ? 'item' : 'general',
    storagePath: `inspections/inspection-1/items/${itemId}/${id}.jpg`,
    downloadUrl: `https://example.com/${id}.jpg`,
    originalName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    size: 100,
    width: 800,
    height: 600,
    caption,
    order: 1,
    uploadStatus: 'completed',
    createdBy: user.uid,
    createdByName: user.name,
    createdAt: null,
  } as unknown as InspectionPhoto;
}

describe('PhotoUploader batch queue', () => {
  beforeEach(() => {
    vi.mocked(uploadInspectionPhoto).mockReset();
    vi.mocked(removeInspectionPhoto).mockReset();
    vi.mocked(discardInspectionPhotoAttempt).mockReset();
    vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => `blob:${(file as File).name}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('queues multiple photos, preserves individual captions and uploads with one confirmation', async () => {
    const onAdded = vi.fn();
    const onPendingChange = vi.fn();
    vi.mocked(uploadInspectionPhoto).mockImplementation(
      async (_inspectionId, itemId, file, caption) => completedPhoto(file.name, itemId, caption),
    );

    render(
      <PhotoUploader
        inspectionId="inspection-1"
        itemId="item-1"
        queueId="item:item-1"
        photos={[]}
        user={user}
        editable
        onAdded={onAdded}
        onRemoved={vi.fn()}
        onPendingChange={onPendingChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Choose from device'), {
      target: { files: [selectedPhoto('first.jpg'), selectedPhoto('second.jpg')] },
    });

    expect(screen.getByText('2 photos awaiting upload')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Caption for selected photo 1'), {
      target: { value: 'Overview' },
    });
    fireEvent.change(screen.getByLabelText('Caption for selected photo 2'), {
      target: { value: 'Detail' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload 2 photos' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(2));
    expect(uploadInspectionPhoto).toHaveBeenNthCalledWith(
      1,
      'inspection-1',
      'item-1',
      expect.objectContaining({ name: 'first.jpg' }),
      'Overview',
      user,
      expect.any(Function),
      undefined,
    );
    expect(uploadInspectionPhoto).toHaveBeenNthCalledWith(
      2,
      'inspection-1',
      'item-1',
      expect.objectContaining({ name: 'second.jpg' }),
      'Detail',
      user,
      expect.any(Function),
      undefined,
    );
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith('item:item-1', 0, false));
    expect(screen.queryByLabelText('Photos awaiting upload')).not.toBeInTheDocument();
  });

  it('keeps only failed photos in the queue and retries the existing upload attempt', async () => {
    const onAdded = vi.fn();
    vi.mocked(uploadInspectionPhoto)
      .mockResolvedValueOnce(completedPhoto('first.jpg', null, ''))
      .mockRejectedValueOnce(
        new PhotoUploadError('Connection failed', {
          stage: 'storage-upload',
          code: 'storage/retry-limit-exceeded',
          photoId: 'failed-photo-id',
        }),
      )
      .mockResolvedValueOnce(completedPhoto('failed-photo-id', null, ''));

    render(
      <PhotoUploader
        inspectionId="inspection-1"
        itemId={null}
        queueId="general"
        photos={[]}
        user={user}
        editable
        onAdded={onAdded}
        onRemoved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Choose from device'), {
      target: { files: [selectedPhoto('first.jpg'), selectedPhoto('failed.jpg')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload 2 photos' }));

    await screen.findByRole('button', { name: 'Retry 1 failed photo' });
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1 photo could not be uploaded/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry 1 failed photo' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(2));
    expect(uploadInspectionPhoto).toHaveBeenLastCalledWith(
      'inspection-1',
      null,
      expect.objectContaining({ name: 'failed.jpg' }),
      '',
      user,
      expect.any(Function),
      'failed-photo-id',
    );
  });
});
