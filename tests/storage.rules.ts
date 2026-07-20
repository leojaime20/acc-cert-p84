import fs from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const projectId = 'acc-cert-photo-rules-test';
let testEnvironment: RulesTestEnvironment | undefined;

async function seedData(environment: RulesTestEnvironment) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, 'users/owner'), {
        active: true,
        role: 'inspector',
        projectIds: ['p84'],
      }),
      setDoc(doc(firestore, 'users/member'), {
        active: true,
        role: 'inspector',
        projectIds: ['p84'],
      }),
      setDoc(doc(firestore, 'users/outsider'), {
        active: true,
        role: 'inspector',
        projectIds: [],
      }),
      setDoc(doc(firestore, 'inspections/draft-inspection'), {
        projectId: 'p84',
        inspectorId: 'owner',
        status: 'draft',
      }),
      setDoc(doc(firestore, 'inspections/completed-inspection'), {
        projectId: 'p84',
        inspectorId: 'owner',
        status: 'completed',
      }),
    ]);
  });
}

async function main() {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
    storage: { rules: fs.readFileSync('storage.rules', 'utf8') },
  });
  await seedData(testEnvironment);

  const ownerStorage = testEnvironment.authenticatedContext('owner').storage();
  const memberStorage = testEnvironment.authenticatedContext('member').storage();
  const outsiderStorage = testEnvironment.authenticatedContext('outsider').storage();
  const anonymousStorage = testEnvironment.unauthenticatedContext().storage();
  const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

  const generalPhoto = ref(ownerStorage, 'inspections/draft-inspection/general/owner-general.jpg');
  await assertSucceeds(uploadBytes(generalPhoto, image, { contentType: 'image/jpeg' }));
  await assertSucceeds(getBytes(ref(memberStorage, generalPhoto.fullPath)));
  await assertFails(getBytes(ref(outsiderStorage, generalPhoto.fullPath)));
  await assertFails(getBytes(ref(anonymousStorage, generalPhoto.fullPath)));

  await assertSucceeds(
    uploadBytes(
      ref(ownerStorage, 'inspections/draft-inspection/items/item-1/owner-item.webp'),
      image,
      { contentType: 'image/webp' },
    ),
  );
  await assertFails(
    uploadBytes(
      ref(memberStorage, 'inspections/draft-inspection/general/not-the-owner.jpg'),
      image,
      { contentType: 'image/jpeg' },
    ),
  );
  await assertFails(
    uploadBytes(
      ref(ownerStorage, 'inspections/completed-inspection/general/completed.jpg'),
      image,
      { contentType: 'image/jpeg' },
    ),
  );
  await assertFails(
    uploadBytes(ref(ownerStorage, 'inspections/draft-inspection/general/not-an-image.pdf'), image, {
      contentType: 'application/pdf',
    }),
  );
  await assertFails(
    uploadBytes(
      ref(ownerStorage, 'inspections/draft-inspection/general/too-large.jpg'),
      new Uint8Array(2 * 1024 * 1024 + 1),
      { contentType: 'image/jpeg' },
    ),
  );
  await assertSucceeds(deleteObject(generalPhoto));

  console.log('Storage rules: 10 verificações aprovadas.');
}

try {
  await main();
} finally {
  await testEnvironment?.cleanup();
}
